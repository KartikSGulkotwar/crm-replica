import type { TriggerType, WorkflowDefinition } from './definition';

export type WorkflowVersionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface WorkflowVersionDto {
  id: string;
  version: number;
  status: WorkflowVersionStatus;
  definition: WorkflowDefinition;
  createdAt: string;
  publishedAt: string | null;
}

export type WorkflowRunStatus =
  'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
export type StepRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING' | 'SKIPPED';

export interface StepRunDto {
  stepId: string;
  name: string;
  type: string;
  status: StepRunStatus;
  attempts: number;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** DELAY steps: when the run continues. */
  resumeAt?: string | null;
}

/** What started a run; available to steps as `{{trigger.…}}`. */
export interface TriggerPayload {
  type: TriggerType;
  object?: string;
  record?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  changedFields?: string[];
  actorUserId?: string | null;
  occurredAt: string;
}

export interface WorkflowRunDto {
  id: string;
  workflowId: string;
  workflowName: string;
  versionId: string;
  version: number;
  status: WorkflowRunStatus;
  isTest: boolean;
  /** How many automations led to this run (loop guard). */
  depth: number;
  trigger: TriggerPayload;
  steps: StepRunDto[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  /** Active = has a published version that triggers. */
  isActive: boolean;
  managedByApp: string | null;
  activeVersion: WorkflowVersionDto | null;
  draftVersion: WorkflowVersionDto | null;
  lastRun: { id: string; status: WorkflowRunStatus; createdAt: string } | null;
  /** SCHEDULE triggers: next time it runs. */
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDraftResponse {
  workflow: WorkflowDto;
  /** Problems that would block publishing (the draft is saved anyway). */
  problems: string[];
}

/** Stops automation loops: a run caused by this many nested automations isn't started. */
export const WORKFLOW_MAX_DEPTH = 5;
