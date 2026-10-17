import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PingJobResult, QUEUES, SYSTEM_JOBS } from '@crm-replica/shared';
import { Worker } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/env';
import { redisOptionsFromUrl } from '../src/redis/redis-connection';
import { setupApp } from '../src/setup-app';

describe('GET /api/health (e2e, needs Postgres + Redis)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports the worker as down when no worker is running', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'up', worker: 'down' });
    expect(res.body.status).toBe('degraded');
  });

  it('reports ok once a worker answers the ping', async () => {
    // Stand-in for apps/worker: answers ping jobs on the same queue.
    const worker = new Worker<unknown, PingJobResult>(
      QUEUES.SYSTEM,
      async (job) => {
        if (job.name !== SYSTEM_JOBS.PING) throw new Error(`unexpected job ${job.name}`);
        return { pong: true, workerPid: process.pid, at: new Date().toISOString() };
      },
      { connection: redisOptionsFromUrl(loadEnv().REDIS_URL), prefix: loadEnv().BULLMQ_PREFIX },
    );
    await worker.waitUntilReady();
    try {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        checks: { database: 'up', redis: 'up', worker: 'up' },
      });
    } finally {
      await worker.close();
    }
  });

  it('serves the OpenAPI spec', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/health');
  });
});
