/** BullMQ queue names shared by the API (producer) and the worker (consumer). */
export const QUEUES = {
  /** Internal housekeeping, e.g. the health-check ping. */
  SYSTEM: 'system',
  /** Workflow runs (and their scheduled triggers). */
  WORKFLOWS: 'workflows',
} as const;

export const WORKFLOW_JOBS = {
  /** Execute (or continue) a run: `{ runId }`. */
  RUN: 'run',
  /** A SCHEDULE trigger fired: `{ workflowId }`. */
  SCHEDULE: 'schedule',
} as const;

export const SYSTEM_JOBS = {
  PING: 'ping',
} as const;

export interface PingJobResult {
  pong: true;
  workerPid: number;
  at: string;
}
