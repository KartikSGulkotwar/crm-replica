import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ChangeSource,
  RecordRef,
  TimelineChange,
  TimelineEventDto,
  TimelineKind,
  TimelinePage,
} from '@crm-replica/shared';
import { DataSource } from 'typeorm';
import {
  ACTIVITY_EVENTS,
  ActivityLinkedEvent,
  RECORD_EVENTS,
  RecordEvent,
} from '../events/record-events';
import { ActivitiesService } from '../records/activities.service';
import { isActivityObject, targetsOf } from '../records/activity-targets';
import { ObjectModel, WorkspaceModel } from '../records/object-model';
import { recordRef } from '../records/record-ref';
import { RecordContext, RecordsService } from '../records/records.service';
import { UUID } from '../records/value-codec';
import { WorkspaceModelService } from '../records/workspace-model.service';

const KIND: Record<RecordEvent['name'], TimelineKind> = {
  [RECORD_EVENTS.CREATED]: 'created',
  [RECORD_EVENTS.UPDATED]: 'updated',
  [RECORD_EVENTS.DELETED]: 'deleted',
  [RECORD_EVENTS.RESTORED]: 'restored',
};
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
/** Kanban drags only move cards; that's not worth a timeline entry. */
const IGNORED_FIELDS = new Set(['position']);

interface NewEvent {
  workspaceId: string;
  object: string;
  recordId: string;
  recordTitle: string;
  kind: TimelineKind;
  actorUserId: string | null;
  source: ChangeSource;
  sourceId: string | null;
  changes?: TimelineChange[];
  activity?: RecordRef | null;
}

interface Row {
  id: string;
  object: string;
  record_id: string;
  record_title: string;
  kind: TimelineKind;
  actor_user_id: string | null;
  actor_name: string | null;
  source: ChangeSource;
  source_label: string | null;
  changes: TimelineChange[];
  activity: RecordRef | null;
  created_at: Date;
  cursor: string;
}

/**
 * The history of each record: created, which fields changed (before → after), deleted /
 * restored, and notes and tasks added to it. Written from record events, so changes made by
 * people, API keys, workflows (in the worker) and the AI assistant all show up.
 */
@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly models: WorkspaceModelService,
    private readonly records: RecordsService,
    private readonly activities: ActivitiesService,
  ) {}

  @OnEvent(RECORD_EVENTS.CREATED)
  @OnEvent(RECORD_EVENTS.UPDATED)
  @OnEvent(RECORD_EVENTS.DELETED)
  @OnEvent(RECORD_EVENTS.RESTORED)
  async onRecordEvent(event: RecordEvent): Promise<void> {
    try {
      const model = await this.models.load({ id: event.workspaceId, schemaName: event.schemaName });
      const object = model.objects.find((o) => o.nameSingular === event.objectName);
      if (!object || object.isSystem) return;
      const ref = recordRef(object, event.record);
      const base = {
        workspaceId: event.workspaceId,
        actorUserId: event.actorUserId,
        source: event.source,
        sourceId: event.sourceId,
      };

      let changes: TimelineChange[] = [];
      if (event.name === RECORD_EVENTS.UPDATED) {
        changes = await this.changes(model, object, event);
        if (!changes.length) return;
      }
      await this.insert({
        ...base,
        object: object.nameSingular,
        recordId: ref.id,
        recordTitle: ref.title,
        kind: KIND[event.name],
        changes,
      });

      // Notes and tasks also show on the records they're linked to.
      if (isActivityObject(object)) {
        let kind: TimelineKind | null = null;
        if (event.name === RECORD_EVENTS.CREATED)
          kind = object.nameSingular === 'note' ? 'note_added' : 'task_added';
        const completed =
          event.name === RECORD_EVENTS.UPDATED &&
          object.nameSingular === 'task' &&
          event.changedFields?.includes('status') &&
          event.record.status === 'DONE';
        if (completed) kind = 'task_completed';
        if (kind) {
          const links = await targetsOf(this.dataSource.manager, event.workspaceId, [ref.id]);
          await this.onTargets(model, base, kind, ref, links.get(ref.id) ?? []);
        }
      }
    } catch (error) {
      this.logger.error(`Couldn’t record timeline for ${event.name}: ${(error as Error).message}`);
    }
  }

  @OnEvent(ACTIVITY_EVENTS.LINKED)
  async onActivityLinked(event: ActivityLinkedEvent): Promise<void> {
    try {
      const model = await this.models.load({ id: event.workspaceId, schemaName: event.schemaName });
      const object = model.objects.find((o) => o.nameSingular === event.activityObject);
      if (!object) return;
      await this.onTargets(
        model,
        {
          workspaceId: event.workspaceId,
          actorUserId: event.actorUserId,
          source: event.source,
          sourceId: event.sourceId,
        },
        object.nameSingular === 'note' ? 'note_added' : 'task_added',
        recordRef(object, event.activity),
        event.targets,
      );
    } catch (error) {
      this.logger.error(`Couldn’t record timeline for a new link: ${(error as Error).message}`);
    }
  }

  /** One record's history, newest first. */
  async forRecord(
    ctx: RecordContext,
    plural: string,
    id: string,
    query: { before?: string; limit?: string },
  ): Promise<TimelinePage> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    if (!UUID.test(id)) return { data: [], nextCursor: null };
    return this.page(
      model,
      ctx.workspace.id,
      query,
      `AND t.object = $4 AND t.record_id = $5::uuid`,
      [object.nameSingular, id],
    );
  }

  /** Everything that happened in the workspace, newest first (the home page feed). */
  async feed(
    ctx: RecordContext,
    query: { before?: string; limit?: string },
  ): Promise<TimelinePage> {
    const model = await this.models.load(ctx.workspace);
    // A new note or task already shows as "created"; "added to <record>" is for record pages.
    return this.page(
      model,
      ctx.workspace.id,
      query,
      `AND t.kind NOT IN ('note_added', 'task_added', 'task_completed')`,
      [],
    );
  }

  private async page(
    model: WorkspaceModel,
    workspaceId: string,
    query: { before?: string; limit?: string },
    where: string,
    params: unknown[],
  ): Promise<TimelinePage> {
    const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
    }
    const cursor = query.before ? decodeCursor(query.before) : null;
    const rows = (await this.dataSource.query(
      `SELECT t.*, u.name AS actor_name, w.name AS source_label, t.created_at::text || '|' || t.id AS cursor
       FROM core.timeline_event t
       LEFT JOIN core."user" u ON u.id = t.actor_user_id
       LEFT JOIN core.workflow w ON t.source = 'workflow' AND w.id = t.source_id
       WHERE t.workspace_id = $1
         AND ($2::timestamptz IS NULL OR (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
         ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${limit + 1}`,
      [workspaceId, cursor?.at ?? null, cursor?.id ?? null, ...params],
    )) as Row[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      data: page.map((r) => toDto(model, r)),
      nextCursor: more ? Buffer.from(page[page.length - 1].cursor).toString('base64url') : null,
    };
  }

  private async changes(model: WorkspaceModel, object: ObjectModel, event: RecordEvent) {
    const changes: TimelineChange[] = [];
    for (const key of event.changedFields ?? []) {
      if (IGNORED_FIELDS.has(key)) continue;
      const field = object.fields.find((f) => f.apiKey === key);
      const before = event.before?.[key] ?? null;
      const after = event.record[key] ?? null;
      const change: TimelineChange = { field: key, label: field?.label ?? key, before, after };
      if (field) {
        const beforeText = await this.records.describeValue(model, field, before);
        const afterText = await this.records.describeValue(model, field, after);
        if (beforeText) change.beforeText = beforeText;
        if (afterText) change.afterText = afterText;
      }
      changes.push(change);
    }
    return changes;
  }

  private async onTargets(
    model: WorkspaceModel,
    base: Pick<NewEvent, 'workspaceId' | 'actorUserId' | 'source' | 'sourceId'>,
    kind: TimelineKind,
    activity: RecordRef,
    targets: { object: string; id: string }[],
  ) {
    for (const target of await this.activities.refs(model, targets)) {
      await this.insert({
        ...base,
        object: target.object,
        recordId: target.id,
        recordTitle: target.title,
        kind,
        activity,
      });
    }
  }

  private async insert(e: NewEvent) {
    await this.dataSource.query(
      `INSERT INTO core.timeline_event
         (workspace_id, object, record_id, record_title, kind, actor_user_id, source, source_id, changes, activity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        e.workspaceId,
        e.object,
        e.recordId,
        e.recordTitle,
        e.kind,
        e.actorUserId,
        e.source,
        e.sourceId,
        JSON.stringify(e.changes ?? []),
        e.activity ? JSON.stringify(e.activity) : null,
      ],
    );
  }
}

function decodeCursor(raw: string): { at: string; id: string } {
  const [at, id] = Buffer.from(raw, 'base64url').toString().split('|');
  if (!at || !id || !UUID.test(id) || Number.isNaN(Date.parse(at))) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id };
}

function toDto(model: WorkspaceModel, r: Row): TimelineEventDto {
  const object = model.objects.find((o) => o.nameSingular === r.object);
  return {
    id: r.id,
    kind: r.kind,
    record: {
      object: r.object,
      objectLabel: object?.labelSingular ?? r.object,
      id: r.record_id,
      title: r.record_title,
      url: object ? `/objects/${object.namePlural}/${r.record_id}` : '',
    },
    actor: r.actor_user_id && r.actor_name ? { id: r.actor_user_id, name: r.actor_name } : null,
    source: r.source,
    sourceLabel: r.source === 'workflow' ? r.source_label : null,
    changes: r.changes,
    activity: r.activity,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
