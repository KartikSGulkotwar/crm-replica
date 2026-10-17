/** BullMQ queue names shared by the API (producer) and the worker (consumer). */
export const QUEUES = {
  /** Internal housekeeping, e.g. the health-check ping. */
  SYSTEM: 'system',
} as const;

export const SYSTEM_JOBS = {
  PING: 'ping',
} as const;

export interface PingJobResult {
  pong: true;
  workerPid: number;
  at: string;
}
