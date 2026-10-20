import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkflowRunDto } from '@crm-replica/shared';
import request from 'supertest';
import { createTestApp, signupAgent, TestApp } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;
jest.setTimeout(30_000);

/**
 * Boots the worker exactly as apps/worker does (WorkerRootModule on its own, next to an API
 * without a processor), so anything the worker forgets to register shows up here.
 */
describe('Worker process composition (e2e)', () => {
  let api: TestApp;
  let worker: INestApplicationContext;
  let admin: Agent;

  beforeAll(async () => {
    api = await createTestApp(); // API only: no workflow processor
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WorkerRootModule } = require('../src/worker-root.module');
    worker = await NestFactory.createApplicationContext(WorkerRootModule, { logger: ['error'] });
    worker.enableShutdownHooks();
    admin = (await signupAgent(api, { workspaceName: 'Worker Co' })).agent;
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
  });

  async function publish(name: string, definition: object) {
    const wf = (await admin.post('/api/workflows').send({ name }).expect(201)).body;
    await admin.put(`/api/workflows/${wf.id}/draft`).send({ definition }).expect(200);
    return (await admin.post(`/api/workflows/${wf.id}/publish`).expect(200)).body;
  }

  async function waitForRun(workflowId: string): Promise<WorkflowRunDto> {
    for (let i = 0; i < 100; i++) {
      const runs: WorkflowRunDto[] = (
        await admin.get(`/api/workflows/${workflowId}/runs`).expect(200)
      ).body;
      if (runs[0] && ['SUCCEEDED', 'FAILED'].includes(runs[0].status)) return runs[0];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('run did not finish');
  }

  it('runs record steps in the worker, and changes made by the worker trigger other workflows', async () => {
    const onWon = await publish('On won', {
      trigger: {
        type: 'RECORD_UPDATED',
        object: 'opportunity',
        fields: ['stage'],
        when: { conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }] },
      },
      steps: [
        {
          id: 'task',
          name: 'Create task',
          type: 'CREATE_RECORD',
          object: 'task',
          values: { title: 'Kick off {{trigger.record.name}}' },
        },
      ],
    });
    // Triggered by the task the worker creates (the listener must run in the worker too).
    const onTask = await publish('On task', {
      trigger: { type: 'RECORD_CREATED', object: 'task' },
      steps: [
        {
          id: 'mail',
          name: 'Email',
          type: 'SEND_EMAIL',
          to: 'a@example.com',
          subject: 'New task: {{trigger.record.title}}',
        },
      ],
    });

    const opp = (
      await admin.post('/api/objects/opportunities').send({ name: 'Acme fleet' }).expect(201)
    ).body;
    await admin.patch(`/api/objects/opportunities/${opp.id}`).send({ stage: 'WON' }).expect(200);

    const first = await waitForRun(onWon.id);
    expect(first).toMatchObject({ status: 'SUCCEEDED', error: null });
    const second = await waitForRun(onTask.id);
    expect(second).toMatchObject({ status: 'SUCCEEDED', depth: 1 });
    expect(second.steps[0].input).toMatchObject({ subject: 'New task: Kick off Acme fleet' });
  });
});
