import { z } from 'zod';
import type { RecordDto } from './records';

/** A link to a record, with what to show for it. */
export interface RecordRef {
  object: string;
  objectLabel: string;
  id: string;
  title: string;
  /** In-app path, e.g. `/objects/companies/<id>`. */
  url: string;
}

/** Objects that can be linked to any record (shown on record pages). */
export const ACTIVITY_OBJECTS = ['note', 'task'] as const;
export type ActivityObject = (typeof ACTIVITY_OBJECTS)[number];

export const recordTargetSchema = z.object({
  object: z.string().min(1).max(63),
  id: z.uuid('id must be a record id'),
});
export const activityTargetsSchema = z.object({
  targets: z.array(recordTargetSchema).max(20, 'Link to at most 20 records'),
});
export type ActivityTargetsInput = z.infer<typeof activityTargetsSchema>;

/** A note or task with the records it's linked to. */
export interface ActivityDto {
  record: RecordDto;
  targets: RecordRef[];
}

export interface RecordActivitiesDto {
  notes: ActivityDto[];
  tasks: ActivityDto[];
}

/** Who or what made a change. */
export type ChangeSource = 'user' | 'api' | 'workflow' | 'agent' | 'demo';

export type TimelineKind =
  'created' | 'updated' | 'deleted' | 'restored' | 'note_added' | 'task_added' | 'task_completed';

export interface TimelineChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  /** Readable values where the raw one isn't (select labels, linked record titles). */
  beforeText?: string;
  afterText?: string;
}

export interface TimelineEventDto {
  id: string;
  kind: TimelineKind;
  record: RecordRef;
  actor: { id: string; name: string } | null;
  source: ChangeSource;
  /** e.g. the workflow's name. */
  sourceLabel: string | null;
  changes: TimelineChange[];
  /** The note or task, for note_added / task_added / task_completed. */
  activity: RecordRef | null;
  createdAt: string;
}

export interface TimelinePage {
  data: TimelineEventDto[];
  /** Pass as `before` to load older events; null at the end. */
  nextCursor: string | null;
}

export interface SearchResultDto extends RecordRef {
  /** A second line, e.g. a person's email or a company's domain. */
  subtitle: string | null;
}
