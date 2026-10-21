import type { ChangeSource, RecordDto } from '@crm-replica/shared';

export const RECORD_EVENTS = {
  CREATED: 'record.created',
  UPDATED: 'record.updated',
  DELETED: 'record.deleted',
  RESTORED: 'record.restored',
} as const;

export type RecordEventName = (typeof RECORD_EVENTS)[keyof typeof RECORD_EVENTS];

/** Emitted after a record change is committed. Workflows (Phase 9) listen to these. */
export interface RecordEvent {
  name: RecordEventName;
  workspaceId: string;
  /** The workspace's Postgres schema (so listeners can read records without another lookup). */
  schemaName: string;
  /** nameSingular of the object, e.g. `opportunity`. */
  objectName: string;
  recordId: string;
  record: RecordDto;
  /** For updates: the record before the change, and the record keys that changed. */
  before?: RecordDto;
  changedFields?: string[];
  /** User who made the change (null for automations). */
  actorUserId: string | null;
  /** What made it: a person in the app, an API key, a workflow (sourceId = its id), the AI assistant… */
  source: ChangeSource;
  sourceId: string | null;
  /**
   * How many automation steps led to this change (0 = a person did it). Workflows stop when it
   * gets too deep, so a workflow updating its own trigger record can't loop forever.
   */
  depth: number;
  occurredAt: string;
}

export const ACTIVITY_EVENTS = {
  /** A note or task was linked to more records (after it was created). */
  LINKED: 'activity.linked',
} as const;

export interface ActivityLinkedEvent {
  workspaceId: string;
  schemaName: string;
  /** `note` or `task`. */
  activityObject: string;
  activity: RecordDto;
  /** Only the newly linked records. */
  targets: { object: string; id: string }[];
  actorUserId: string | null;
  source: ChangeSource;
  sourceId: string | null;
}
