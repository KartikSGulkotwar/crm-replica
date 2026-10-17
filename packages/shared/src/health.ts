export type ComponentStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: {
    database: ComponentStatus;
    redis: ComponentStatus;
    worker: ComponentStatus;
  };
}
