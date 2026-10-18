import { PingJobResult, QUEUES, SYSTEM_JOBS } from '@crm-replica/shared';
import { Worker } from 'bullmq';
import { loadEnv } from '../src/config/env';
import { redisOptionsFromUrl } from '../src/redis/redis-connection';
import { createTestApp, TestApp } from './utils/test-app';

describe('GET /api/health (e2e, needs Postgres + Redis)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t?.close());

  it('is public and reports the worker as down when no worker is running', async () => {
    const res = await t.http().get('/api/health').expect(200);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'up', worker: 'down' });
    expect(res.body.status).toBe('degraded');
  });

  it('reports ok once a worker answers the ping', async () => {
    const env = loadEnv();
    // Stand-in for apps/worker: answers ping jobs on the same queue.
    const worker = new Worker<unknown, PingJobResult>(
      QUEUES.SYSTEM,
      async (job) => {
        if (job.name !== SYSTEM_JOBS.PING) throw new Error(`unexpected job ${job.name}`);
        return { pong: true, workerPid: process.pid, at: new Date().toISOString() };
      },
      { connection: redisOptionsFromUrl(env.REDIS_URL), prefix: env.BULLMQ_PREFIX },
    );
    await worker.waitUntilReady();
    try {
      const res = await t.http().get('/api/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        checks: { database: 'up', redis: 'up', worker: 'up' },
      });
    } finally {
      await worker.close();
    }
  });

  it('serves the OpenAPI spec', async () => {
    const res = await t.http().get('/api/docs-json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/health');
    expect(res.body.paths).toHaveProperty('/api/auth/signup');
  });
});
