import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  evaluateConditions,
  TriggerPayload,
  TriggerType,
  WORKFLOW_MAX_DEPTH,
  WorkflowDefinition,
} from '@crm-replica/shared';
import { DataSource } from 'typeorm';
import { RECORD_EVENTS, RecordEvent } from '../events/record-events';
import { WorkflowRunsService } from './workflow-runs.service';

const TRIGGER_FOR: Partial<Record<string, TriggerType>> = {
  [RECORD_EVENTS.CREATED]: TriggerType.RECORD_CREATED,
  [RECORD_EVENTS.UPDATED]: TriggerType.RECORD_UPDATED,
  [RECORD_EVENTS.DELETED]: TriggerType.RECORD_DELETED,
};

/**
 * Turns record events into workflow runs. Registered in both the API and the worker, so
 * changes made by workflows can trigger other workflows (up to the loop-guard depth).
 */
@Injectable()
export class WorkflowTriggerListener {
  private readonly logger = new Logger(WorkflowTriggerListener.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: WorkflowRunsService,
  ) {}

  @OnEvent(RECORD_EVENTS.CREATED)
  @OnEvent(RECORD_EVENTS.UPDATED)
  @OnEvent(RECORD_EVENTS.DELETED)
  async onRecordEvent(event: RecordEvent): Promise<void> {
    const type = TRIGGER_FOR[event.name];
    // Loading demo data adds a lot of records at once; it shouldn't set off automations.
    if (!type || event.source === 'demo') return;
    const matches = (await this.dataSource.query(
      `SELECT w.id AS workflow_id, v.id AS version_id, v.definition
       FROM core.workflow w JOIN core.workflow_version v ON v.id = w.active_version_id
       WHERE w.workspace_id = $1 AND v.status = 'ACTIVE'
         AND v.definition->'trigger'->>'type' = $2 AND v.definition->'trigger'->>'object' = $3`,
      [event.workspaceId, type, event.objectName],
    )) as { workflow_id: string; version_id: string; definition: WorkflowDefinition }[];

    for (const match of matches) {
      const trigger = match.definition.trigger;
      const payload: TriggerPayload = {
        type,
        object: event.objectName,
        record: event.record,
        before: event.before ?? null,
        changedFields: event.changedFields ?? [],
        actorUserId: event.actorUserId,
        occurredAt: event.occurredAt,
      };
      if (trigger.type === TriggerType.RECORD_UPDATED && trigger.fields?.length) {
        // Field names or their record keys (`company` / `companyId`).
        const changed = new Set(
          (event.changedFields ?? []).flatMap((f) => [f, f.replace(/Id$/, '')]),
        );
        if (!trigger.fields.some((f) => changed.has(f))) continue;
      }
      if ('when' in trigger && !evaluateConditions(trigger.when, { trigger: payload })) continue;

      const run = {
        workspaceId: event.workspaceId,
        workflowId: match.workflow_id,
        versionId: match.version_id,
        trigger: payload,
        depth: event.depth,
      };
      if (event.depth >= WORKFLOW_MAX_DEPTH) {
        this.logger.warn(
          `Loop guard: not starting workflow ${match.workflow_id} at depth ${event.depth}`,
        );
        await this.runs.skip(
          run,
          `Stopped: ${event.depth} automations in a row triggered this (possible loop). The limit is ${WORKFLOW_MAX_DEPTH}.`,
        );
        continue;
      }
      await this.runs.start(run);
    }
  }
}
