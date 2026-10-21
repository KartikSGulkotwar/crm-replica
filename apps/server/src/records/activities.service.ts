import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityDto, RecordActivitiesDto, RecordDto, RecordRef } from '@crm-replica/shared';
import { DataSource } from 'typeorm';
import { ACTIVITY_EVENTS, ActivityLinkedEvent } from '../events/record-events';
import { qualified } from '../schema-sync/sql';
import { isActivityObject, replaceTargets, resolveTargets, targetsOf } from './activity-targets';
import { WorkspaceModel } from './object-model';
import { recordRef } from './record-ref';
import { RecordContext } from './records.service';
import { RecordValidationError, rowToRecord, UUID } from './value-codec';
import { WorkspaceModelService } from './workspace-model.service';

/** Notes or tasks shown on one record page. */
const MAX_PER_RECORD = 100;

/** Notes and tasks linked to records (see activity-targets.ts). */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly models: WorkspaceModelService,
    private readonly events: EventEmitter2,
  ) {}

  /** The notes and tasks linked to a record, newest notes first and open tasks first. */
  async forRecord(ctx: RecordContext, plural: string, id: string): Promise<RecordActivitiesDto> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    await this.assertLive(model, object.nameSingular, id);
    const links = (await this.dataSource.query(
      `SELECT activity_object, activity_id FROM core.activity_target
       WHERE workspace_id = $1 AND target_object = $2 AND target_id = $3::uuid`,
      [ctx.workspace.id, object.nameSingular, id],
    )) as { activity_object: 'note' | 'task'; activity_id: string }[];
    const load = async (kind: 'note' | 'task') =>
      this.withTargets(
        ctx,
        model,
        await this.rows(
          model,
          kind,
          links.filter((l) => l.activity_object === kind).map((l) => l.activity_id),
        ),
      );
    const notes = await load('note');
    const tasks = await load('task');
    notes.sort((a, b) => String(b.record.createdAt).localeCompare(String(a.record.createdAt)));
    const done = (t: ActivityDto) => (t.record.status === 'DONE' ? 1 : 0);
    const due = (t: ActivityDto) => (t.record.dueDate as string | null) ?? '9999';
    tasks.sort((a, b) => done(a) - done(b) || due(a).localeCompare(due(b)));
    return { notes, tasks };
  }

  /** The records a note or task is linked to. */
  async targets(ctx: RecordContext, plural: string, id: string): Promise<RecordRef[]> {
    const { model, object } = await this.activityObject(ctx, plural);
    await this.assertLive(model, object.nameSingular, id);
    const map = await targetsOf(this.dataSource.manager, ctx.workspace.id, [id]);
    return this.refs(model, map.get(id) ?? []);
  }

  /** Replaces what a note or task is linked to. */
  async setTargets(
    ctx: RecordContext,
    plural: string,
    id: string,
    targets: { object: string; id: string }[],
  ): Promise<RecordRef[]> {
    const { model, object } = await this.activityObject(ctx, plural);
    const { activity, added } = await this.dataSource
      .transaction(async (em) => {
        const [row] = (await em.query(
          `SELECT * FROM ${qualified(model.schema, object.tableName)} WHERE "id" = $1::uuid AND "deleted_at" IS NULL FOR UPDATE`,
          [id],
        )) as Record<string, unknown>[];
        if (!row) throw new NotFoundException(`${object.labelSingular} not found`);
        const resolved = await resolveTargets(em, model, targets);
        const added = await replaceTargets(
          em,
          ctx.workspace.id,
          { object: object.nameSingular, id },
          resolved,
        );
        return { activity: rowToRecord(object, row), added };
      })
      .catch((error: unknown) => {
        if (error instanceof RecordValidationError) {
          throw new BadRequestException(error.messages.join('; '));
        }
        throw error;
      });
    if (added.length) {
      const event: ActivityLinkedEvent = {
        workspaceId: ctx.workspace.id,
        schemaName: ctx.workspace.schemaName,
        activityObject: object.nameSingular,
        activity,
        targets: added.map((t) => ({ object: t.object.nameSingular, id: t.id })),
        actorUserId: ctx.userId,
        source: ctx.source ?? 'user',
        sourceId: ctx.sourceId ?? null,
      };
      await this.events.emitAsync(ACTIVITY_EVENTS.LINKED, event).catch(() => undefined);
    }
    return this.targets(ctx, plural, id);
  }

  /** Links for records given as object name + id; missing or deleted records are left out. */
  async refs(model: WorkspaceModel, pairs: { object: string; id: string }[]): Promise<RecordRef[]> {
    const byObject = new Map<string, string[]>();
    for (const p of pairs) byObject.set(p.object, [...(byObject.get(p.object) ?? []), p.id]);
    const found = new Map<string, RecordRef>();
    for (const [name, ids] of byObject) {
      const object = model.objects.find((o) => o.nameSingular === name);
      if (!object) continue;
      for (const record of await this.rows(model, name, ids)) {
        found.set(`${name}:${record.id}`, recordRef(object, record));
      }
    }
    return pairs.flatMap((p) => found.get(`${p.object}:${p.id}`) ?? []);
  }

  private async withTargets(
    ctx: RecordContext,
    model: WorkspaceModel,
    records: RecordDto[],
  ): Promise<ActivityDto[]> {
    const map = await targetsOf(
      this.dataSource.manager,
      ctx.workspace.id,
      records.map((r) => r.id),
    );
    const refs = await this.refs(model, [...map.values()].flat());
    const refOf = new Map(refs.map((r) => [`${r.object}:${r.id}`, r]));
    return records.map((record) => ({
      record,
      targets: (map.get(record.id) ?? []).flatMap((t) => refOf.get(`${t.object}:${t.id}`) ?? []),
    }));
  }

  /** Live records of one object by id. */
  private async rows(
    model: WorkspaceModel,
    objectName: string,
    ids: string[],
  ): Promise<RecordDto[]> {
    const object = model.objects.find((o) => o.nameSingular === objectName);
    const valid = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, MAX_PER_RECORD * 2);
    if (!object || !valid.length) return [];
    const rows = (await this.dataSource.query(
      `SELECT * FROM ${qualified(model.schema, object.tableName)} WHERE "id" = ANY($1::uuid[]) AND "deleted_at" IS NULL`,
      [valid],
    )) as Record<string, unknown>[];
    return rows.map((row) => rowToRecord(object, row)).slice(0, MAX_PER_RECORD);
  }

  private async activityObject(ctx: RecordContext, plural: string) {
    const found = await this.models.object(ctx.workspace, plural);
    if (!isActivityObject(found.object)) {
      throw new BadRequestException('Only notes and tasks can be linked to records');
    }
    return found;
  }

  private async assertLive(model: WorkspaceModel, objectName: string, id: string) {
    const object = model.objects.find((o) => o.nameSingular === objectName)!;
    if (!(await this.rows(model, objectName, [id])).length) {
      throw new NotFoundException(`${object.labelSingular} not found`);
    }
  }
}
