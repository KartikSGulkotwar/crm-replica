import { getQueueToken } from '@nestjs/bullmq';
import { QUEUES, WorkflowRunDto } from '@crm-replica/shared';
import { Queue } from 'bullmq';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { LlmClient } from '../src/llm/llm-client';
import { FakeLlm, message, text } from './utils/fake-llm';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;
jest.setTimeout(30_000);

describe('Workflows (e2e, with a real queue and worker)', () => {
  let t: TestApp;
  let admin: Agent;
  let acmeId: string;
  const llm = new FakeLlm();

  // A tiny webhook receiver: fails the first `failures` calls with 500, then answers 200.
  let hook: Server;
  let hookUrl: string;
  let failures = 0;
  const received: unknown[] = [];

  const create = async (plural: string, body: object) =>
    (await admin.post(`/api/objects/${plural}`).send(body).expect(201)).body;

  /** Creates a workflow, saves the definition as its draft and publishes it. */
  async function publish(name: string, definition: object) {
    const wf = (await admin.post('/api/workflows').send({ name }).expect(201)).body;
    const saved = await admin.put(`/api/workflows/${wf.id}/draft`).send({ definition }).expect(200);
    expect(saved.body.problems).toEqual([]);
    return (await admin.post(`/api/workflows/${wf.id}/publish`).expect(200)).body;
  }

  /** Polls a workflow's runs until `done` says so (or times out). */
  async function waitForRuns(
    workflowId: string,
    done: (runs: WorkflowRunDto[]) => boolean,
    timeoutMs = 15_000,
  ): Promise<WorkflowRunDto[]> {
    const start = Date.now();
    for (;;) {
      const runs: WorkflowRunDto[] = (
        await admin.get(`/api/workflows/${workflowId}/runs`).expect(200)
      ).body;
      if (done(runs)) return runs;
      if (Date.now() - start > timeoutMs)
        throw new Error(`Timed out; runs: ${JSON.stringify(runs.map((r) => [r.status, r.error]))}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const finished = (r: WorkflowRunDto) => ['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(r.status);

  beforeAll(async () => {
    hook = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (failures > 0) {
          failures--;
          res.writeHead(500).end('try again');
          return;
        }
        received.push(JSON.parse(body || 'null'));
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;

    t = await createTestApp({ withWorker: true, overrides: [[LlmClient, llm]] });
    admin = (await signupAgent(t, { workspaceName: 'Flows Co' })).agent;
    acmeId = (await create('companies', { name: 'Acme' })).id;
  });

  afterAll(async () => {
    await t?.close();
    await new Promise((r) => hook?.close(r));
  });

  it('when an opportunity moves to Won: creates a task and sends an email (the spec’s example)', async () => {
    const wf = await publish('Won deal follow-up', {
      trigger: {
        type: 'RECORD_UPDATED',
        object: 'opportunity',
        fields: ['stage'],
        when: { conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }] },
      },
      steps: [
        {
          id: 'create_task',
          name: 'Create kickoff task',
          type: 'CREATE_RECORD',
          object: 'task',
          values: { title: 'Kick off {{trigger.record.name}}', status: 'TO_DO' },
        },
        {
          id: 'notify',
          name: 'Email the team',
          type: 'SEND_EMAIL',
          to: 'sales@example.com',
          subject: 'Won: {{trigger.record.name}}',
          body: 'Task {{steps.create_task.result.id}} was created.',
        },
      ],
    });
    expect(wf).toMatchObject({
      isActive: true,
      activeVersion: { version: 1, status: 'ACTIVE' },
      draftVersion: null,
    });

    const opp = await create('opportunities', { name: 'Acme fleet', companyId: acmeId });
    await admin
      .patch(`/api/objects/opportunities/${opp.id}`)
      .send({ stage: 'QUALIFIED' })
      .expect(200); // not Won: no run
    await admin
      .patch(`/api/objects/opportunities/${opp.id}`)
      .send({ name: 'Acme fleet deal' })
      .expect(200); // stage didn't change: no run
    await admin.patch(`/api/objects/opportunities/${opp.id}`).send({ stage: 'WON' }).expect(200);

    const [run] = await waitForRuns(wf.id, (runs) => runs.length === 1 && finished(runs[0]));
    expect(run).toMatchObject({ status: 'SUCCEEDED', version: 1, depth: 0, isTest: false });
    expect(run.trigger).toMatchObject({
      type: 'RECORD_UPDATED',
      object: 'opportunity',
      changedFields: ['stage'],
      record: { id: opp.id, stage: 'WON' },
    });
    expect(run.steps.map((s) => [s.stepId, s.status, s.attempts])).toEqual([
      ['create_task', 'SUCCEEDED', 1],
      ['notify', 'SUCCEEDED', 1],
    ]);
    const task = run.steps[0].output as { id: string; title: string; createdBy: string | null };
    expect(task).toMatchObject({ title: 'Kick off Acme fleet deal', createdBy: null });
    expect(run.steps[1].input).toMatchObject({
      subject: 'Won: Acme fleet deal',
      body: `Task ${task.id} was created.`,
    });
    expect(run.steps[1].output).toMatchObject({
      delivered: false,
      provider: 'log',
      to: ['sales@example.com'],
    });
    // The task really exists.
    await admin.get(`/api/objects/tasks/${task.id}`).expect(200);
  });

  it('passes results between steps and follows if/else branches', async () => {
    const wf = await publish('Tag big companies', {
      trigger: { type: 'RECORD_CREATED', object: 'person' },
      steps: [
        {
          id: 'find_company',
          name: 'Find company',
          type: 'FIND_RECORDS',
          object: 'company',
          filter: { field: 'id', op: 'eq', value: '{{trigger.record.companyId}}' },
          limit: 1,
        },
        {
          id: 'is_big',
          name: 'Big company?',
          type: 'IF_ELSE',
          condition: {
            conditions: [
              { left: '{{steps.find_company.result.first.employees}}', op: 'gte', right: '1000' },
            ],
          },
          then: [
            {
              id: 'mark_big',
              name: 'Mark big',
              type: 'UPDATE_RECORD',
              object: 'person',
              recordId: '{{trigger.record.id}}',
              values: {
                jobTitle: 'Works at a big company ({{steps.find_company.result.first.name}})',
              },
            },
          ],
          else: [
            {
              id: 'mark_small',
              name: 'Mark small',
              type: 'UPDATE_RECORD',
              object: 'person',
              recordId: '{{trigger.record.id}}',
              values: { jobTitle: 'Works at a small company' },
            },
          ],
        },
      ],
    });
    const globex = await create('companies', { name: 'Globex', employees: 5000 });
    const big = await create('people', { firstName: 'Hank', companyId: globex.id });
    const small = await create('people', { firstName: 'Bob', companyId: acmeId });

    const runs = await waitForRuns(wf.id, (r) => r.length === 2 && r.every(finished));
    for (const run of runs) expect(run.status).toBe('SUCCEEDED');
    const byPerson = (id: string) =>
      runs.find((r) => (r.trigger.record as { id: string }).id === id)!;
    expect(byPerson(big.id).steps.map((s) => s.stepId)).toEqual([
      'find_company',
      'is_big',
      'mark_big',
    ]);
    expect(byPerson(small.id).steps.map((s) => s.stepId)).toEqual([
      'find_company',
      'is_big',
      'mark_small',
    ]);
    expect((await admin.get(`/api/objects/people/${big.id}`).expect(200)).body.jobTitle).toBe(
      'Works at a big company (Globex)',
    );
    expect((await admin.get(`/api/objects/people/${small.id}`).expect(200)).body.jobTitle).toBe(
      'Works at a small company',
    );
  });

  it('retries a failing step with backoff, without repeating earlier steps', async () => {
    failures = 2;
    received.length = 0;
    const wf = await publish('Webhook on new note', {
      trigger: { type: 'RECORD_CREATED', object: 'note' },
      steps: [
        {
          id: 'make_task',
          name: 'Create task',
          type: 'CREATE_RECORD',
          object: 'task',
          values: { title: 'Read note {{trigger.record.title}}' },
        },
        {
          id: 'call_hook',
          name: 'Call webhook',
          type: 'HTTP_REQUEST',
          method: 'POST',
          url: hookUrl,
          body: { note: '{{trigger.record.title}}', task: '{{steps.make_task.result.id}}' },
        },
      ],
    });
    await create('notes', { title: 'Retry me' });
    const [run] = await waitForRuns(wf.id, (r) => r.length === 1 && finished(r[0]));
    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps.map((s) => [s.stepId, s.status, s.attempts])).toEqual([
      ['make_task', 'SUCCEEDED', 1], // not repeated on retry
      ['call_hook', 'SUCCEEDED', 3], // failed twice with 500, then worked
    ]);
    expect(received).toEqual([
      { note: 'Retry me', task: (run.steps[0].output as { id: string }).id },
    ]);
    const tasks = (
      await admin
        .get('/api/objects/tasks')
        .query({
          filter: JSON.stringify({ field: 'title', op: 'eq', value: 'Read note Retry me' }),
        })
        .expect(200)
    ).body;
    expect(tasks.totalCount).toBe(1);
  });

  it('fails immediately (no retries) when a step can never succeed', async () => {
    const wf = await publish('Bad value', {
      trigger: { type: 'RECORD_CREATED', object: 'company' },
      steps: [
        {
          id: 'bad',
          name: 'Create bad task',
          type: 'CREATE_RECORD',
          object: 'task',
          values: { status: 'NOT_A_STATUS' },
        },
      ],
    });
    await create('companies', { name: 'Trigger co' });
    const [run] = await waitForRuns(wf.id, (r) => r.length === 1 && finished(r[0]));
    expect(run.status).toBe('FAILED');
    expect(run.steps[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      error: expect.stringContaining('status must be one of'),
    });
    expect(run.error).toContain('Create bad task');
    await admin.post(`/api/workflows/${wf.id}/deactivate`).expect(200);
  });

  it('pauses on a delay step and continues afterwards', async () => {
    const wf = await publish('Delayed', {
      trigger: { type: 'MANUAL' },
      steps: [
        { id: 'wait', name: 'Wait a second', type: 'DELAY', seconds: 1 },
        {
          id: 'after',
          name: 'Email after',
          type: 'SEND_EMAIL',
          to: 'a@example.com',
          subject: 'Later',
        },
      ],
    });
    const started = (await admin.post(`/api/workflows/${wf.id}/run`).send({}).expect(202)).body;
    const waiting = await waitForRuns(wf.id, (r) => r[0]?.status === 'WAITING');
    expect(waiting[0].steps[0]).toMatchObject({ status: 'WAITING', resumeAt: expect.any(String) });
    const [done] = await waitForRuns(wf.id, (r) => finished(r[0]));
    expect(done).toMatchObject({ id: started.id, status: 'SUCCEEDED' });
    expect(done.steps.map((s) => s.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(Date.parse(done.finishedAt!) - Date.parse(done.createdAt)).toBeGreaterThanOrEqual(900);
  });

  it('stops a workflow that keeps re-triggering itself (loop guard)', async () => {
    const wf = await publish('Echo', {
      trigger: { type: 'RECORD_UPDATED', object: 'company', fields: ['domain'] },
      steps: [
        {
          id: 'echo',
          name: 'Change domain again',
          type: 'UPDATE_RECORD',
          object: 'company',
          recordId: '{{trigger.record.id}}',
          values: { domain: 'x{{trigger.record.domain}}' },
        },
      ],
    });
    const c = await create('companies', { name: 'Loopy' });
    await admin.patch(`/api/objects/companies/${c.id}`).send({ domain: 'loop.io' }).expect(200);
    const runs = await waitForRuns(
      wf.id,
      (r) => r.some((x) => x.status === 'SKIPPED') && r.every(finished),
    );
    expect(runs.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(5);
    const skipped = runs.find((r) => r.status === 'SKIPPED')!;
    expect(skipped).toMatchObject({ depth: 5, error: expect.stringContaining('possible loop') });
    expect((await admin.get(`/api/objects/companies/${c.id}`).expect(200)).body.domain).toBe(
      'xxxxxloop.io',
    );
    await admin.post(`/api/workflows/${wf.id}/deactivate`).expect(200);
  });

  it('versions: edits are drafts; runs keep the version they ran', async () => {
    const wf = await publish('Versioned', {
      trigger: { type: 'MANUAL' },
      steps: [
        { id: 'mail', name: 'Email v1', type: 'SEND_EMAIL', to: 'a@example.com', subject: 'v1' },
      ],
    });
    const v1Run = (await admin.post(`/api/workflows/${wf.id}/run`).send({}).expect(202)).body;
    const draft = await admin
      .put(`/api/workflows/${wf.id}/draft`)
      .send({
        definition: {
          trigger: { type: 'MANUAL' },
          steps: [
            {
              id: 'mail',
              name: 'Email v2',
              type: 'SEND_EMAIL',
              to: 'a@example.com',
              subject: 'v2',
            },
          ],
        },
      })
      .expect(200);
    expect(draft.body.workflow).toMatchObject({
      activeVersion: { version: 1 },
      draftVersion: { version: 2, status: 'DRAFT' },
    });
    const stillV1 = (await admin.post(`/api/workflows/${wf.id}/run`).send({}).expect(202)).body;
    expect(stillV1.version).toBe(1);
    const published = (await admin.post(`/api/workflows/${wf.id}/publish`).expect(200)).body;
    expect(published).toMatchObject({ activeVersion: { version: 2 }, draftVersion: null });
    const v2Run = (await admin.post(`/api/workflows/${wf.id}/run`).send({}).expect(202)).body;
    expect(v2Run.version).toBe(2);
    const runs = await waitForRuns(wf.id, (r) => r.length === 3 && r.every(finished));
    expect(runs.find((r) => r.id === v1Run.id)!.steps[0].input).toMatchObject({ subject: 'v1' });
    expect(runs.find((r) => r.id === v2Run.id)!.steps[0].input).toMatchObject({ subject: 'v2' });
  });

  it('validates drafts against the data model and blocks publishing until fixed', async () => {
    const wf = (await admin.post('/api/workflows').send({ name: 'Broken' }).expect(201)).body;
    const saved = await admin
      .put(`/api/workflows/${wf.id}/draft`)
      .send({
        definition: {
          trigger: { type: 'RECORD_UPDATED', object: 'unicorn', fields: ['horn'] },
          steps: [
            {
              id: 'a',
              name: 'Use later step',
              type: 'SEND_EMAIL',
              to: '{{steps.b.result.email}}',
              subject: 'x',
            },
            {
              id: 'b',
              name: 'Create',
              type: 'CREATE_RECORD',
              object: 'person',
              values: { company: 'x', nope: 1 },
            },
          ],
        },
      })
      .expect(200);
    expect(saved.body.problems).toEqual([
      'Trigger: object "unicorn" doesn’t exist',
      'Use later step: {{steps.b.result.email}} refers to a step that doesn’t run before this one',
      'Create: use "companyId" to set Company',
      'Create: Person has no field "nope"',
    ]);
    const res = await admin.post(`/api/workflows/${wf.id}/publish`).expect(400);
    expect(res.body.message).toHaveLength(4);
    await admin.post(`/api/workflows/${wf.id}/test`).send({}).expect(400);
    await admin
      .put(`/api/workflows/${wf.id}/draft`)
      .send({ definition: { trigger: { type: 'NOPE' }, steps: [] } })
      .expect(400);
  });

  it('test runs use the draft with the newest record, and are marked as tests', async () => {
    const wf = (await admin.post('/api/workflows').send({ name: 'Try me' }).expect(201)).body;
    await admin
      .put(`/api/workflows/${wf.id}/draft`)
      .send({
        definition: {
          trigger: { type: 'RECORD_CREATED', object: 'company' },
          steps: [
            {
              id: 'mail',
              name: 'Email',
              type: 'SEND_EMAIL',
              to: 'a@example.com',
              subject: 'New: {{trigger.record.name}}',
            },
          ],
        },
      })
      .expect(200);
    const latest = await create('companies', { name: 'Newest Co' });
    const run = (await admin.post(`/api/workflows/${wf.id}/test`).send({}).expect(202)).body;
    expect(run).toMatchObject({ isTest: true, version: 1, trigger: { record: { id: latest.id } } });
    const [done] = await waitForRuns(wf.id, (r) => finished(r[0]));
    expect(done.steps[0].input).toMatchObject({ subject: 'New: Newest Co' });
    expect((await admin.get(`/api/workflows/${wf.id}`).expect(200)).body.isActive).toBe(false); // still just a draft
  });

  it('registers and removes the cron schedule of SCHEDULE workflows', async () => {
    const wf = await publish('Monday report', {
      trigger: { type: 'SCHEDULE', cron: '0 9 * * 1', timezone: 'UTC' },
      steps: [
        {
          id: 'mail',
          name: 'Email',
          type: 'SEND_EMAIL',
          to: 'a@example.com',
          subject: 'Weekly report',
        },
      ],
    });
    expect(new Date(wf.nextRunAt).getUTCDay()).toBe(1);
    const queue = t.app.get<Queue>(getQueueToken(QUEUES.WORKFLOWS));
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toContain(`schedule:${wf.id}`);
    await admin.post(`/api/workflows/${wf.id}/deactivate`).expect(200);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain(`schedule:${wf.id}`);
  });

  it('lets members see and run workflows but not change them; keeps workspaces apart', async () => {
    const wf = await publish('Manual for members', {
      trigger: { type: 'MANUAL', object: 'company' },
      steps: [
        {
          id: 'mail',
          name: 'Email',
          type: 'SEND_EMAIL',
          to: 'a@example.com',
          subject: '{{trigger.record.name}}',
        },
      ],
    });
    const link = await admin.get('/api/workspace/invite-link').expect(200);
    const member = request.agent(t.app.getHttpServer());
    await member
      .post(`/api/invites/${link.body.token}/accept`)
      .send({ name: 'Mo', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    await member.get('/api/workflows').expect(200);
    const run = (
      await member.post(`/api/workflows/${wf.id}/run`).send({ recordId: acmeId }).expect(202)
    ).body;
    expect(run.trigger.record.name).toBe('Acme');
    await member.post(`/api/workflows/${wf.id}/run`).send({}).expect(400); // needs a record
    await member.post('/api/workflows').send({ name: 'Mine' }).expect(403);
    await member.post(`/api/workflows/${wf.id}/publish`).expect(403);
    await member.post(`/api/workflows/${wf.id}/test`).send({}).expect(403);

    const other = await signupAgent(t, { workspaceName: 'Elsewhere' });
    await other.agent.get(`/api/workflows/${wf.id}`).expect(404);
    await other.agent.post(`/api/workflows/${wf.id}/run`).send({ recordId: acmeId }).expect(404);
    await other.agent.get(`/api/workflow-runs/${run.id}`).expect(404);
    expect((await other.agent.get('/api/workflows').expect(200)).body).toEqual([]);
  });

  describe('AI step', () => {
    beforeEach(() => llm.reset());
    const answer = (value: string) => message([text(JSON.stringify({ answer: value }))]);
    const runOn = async (workflowId: string, recordId: string) => {
      await admin.post(`/api/workflows/${workflowId}/run`).send({ recordId }).expect(202);
      const [run] = await waitForRuns(workflowId, (runs) => runs.length > 0 && finished(runs[0]));
      return run;
    };

    it('classifies a record into a select field’s options and saves the answer', async () => {
      const company = await create('companies', { name: 'Ledgerly', domain: 'ledgerly.io' });
      const wf = await publish('Classify industry', {
        trigger: { type: 'MANUAL', object: 'company' },
        steps: [
          {
            id: 'classify',
            name: 'Classify industry',
            type: 'AI',
            prompt: 'Which industry is {{trigger.record.name}} ({{trigger.record.domain}}) in?',
            output: { object: 'company', recordId: '{{trigger.record.id}}', field: 'industry' },
          },
          {
            id: 'mail',
            name: 'Email',
            type: 'SEND_EMAIL',
            to: 'sales@example.com',
            subject: 'Industry: {{steps.classify.result.answer}}',
          },
        ],
      });
      llm.script(answer('FINANCE'));
      const run = await runOn(wf.id, company.id);
      expect(run.status).toBe('SUCCEEDED');
      expect(run.steps[0].output).toEqual({ answer: 'FINANCE', recordId: company.id });
      expect(run.steps[1].output).toMatchObject({ subject: 'Industry: FINANCE' });
      expect(
        (await admin.get(`/api/objects/companies/${company.id}`).expect(200)).body.industry,
      ).toBe('FINANCE');

      // What the model was asked: the filled-in prompt, constrained to the field's options.
      const [call] = llm.calls;
      expect(call.messages[0].content).toContain('Which industry is Ledgerly (ledgerly.io) in?');
      const format = call.output_config?.format as unknown as {
        schema: { properties: { answer: unknown } };
      };
      expect(format.schema.properties.answer).toEqual({
        type: 'string',
        enum: [
          'SOFTWARE',
          'FINANCE',
          'HEALTHCARE',
          'RETAIL',
          'MANUFACTURING',
          'EDUCATION',
          'OTHER',
        ],
      });
    });

    it('summarises into a text field, retrying an answer that isn’t a valid choice', async () => {
      const task = (await admin.post('/api/objects/tasks').send({ title: 'Call Acme' }).expect(201))
        .body;
      const wf = await publish('Summarise task', {
        trigger: { type: 'MANUAL', object: 'task' },
        steps: [
          {
            id: 'sum',
            name: 'Summarise',
            type: 'AI',
            prompt: 'Write one line for: {{trigger.record.title}}',
            choices: ['Short', 'Long'],
            output: { object: 'task', recordId: '{{trigger.record.id}}', field: 'body' },
          },
        ],
      });
      llm.script(answer('Medium'), answer('Short'));
      const run = await runOn(wf.id, task.id);
      expect(run.status).toBe('SUCCEEDED');
      expect(run.steps[0].attempts).toBe(2);
      expect((await admin.get(`/api/objects/tasks/${task.id}`).expect(200)).body.body).toBe(
        'Short',
      );
    });

    it('fails without retrying when AI isn’t set up or the model declines', async () => {
      const wf = await publish('AI without key', {
        trigger: { type: 'MANUAL', object: 'company' },
        steps: [{ id: 'ai', name: 'Ask', type: 'AI', prompt: 'Describe {{trigger.record.name}}' }],
      });
      llm.configured = false;
      let run = await runOn(wf.id, acmeId);
      expect(run.status).toBe('FAILED');
      expect(run.steps[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(run.error).toMatch(/ANTHROPIC_API_KEY/);
      expect(llm.calls).toHaveLength(0);

      llm.configured = true;
      llm.script(message([], 'refusal'));
      await admin.post(`/api/workflows/${wf.id}/run`).send({ recordId: acmeId }).expect(202);
      const runs = await waitForRuns(wf.id, (r) => r.length === 2 && finished(r[0]));
      run = runs[0];
      expect(run.status).toBe('FAILED');
      expect(run.error).toMatch(/declined/);
      expect(llm.calls).toHaveLength(1);
    });

    it('validates the output field and choices against the data model', async () => {
      const wf = (await admin.post('/api/workflows').send({ name: 'Bad AI' }).expect(201)).body;
      const step = (id: string, output: object, choices?: string[]) => ({
        id,
        name: `AI ${id}`,
        type: 'AI',
        prompt: 'x',
        ...(choices ? { choices } : {}),
        output: { recordId: '{{trigger.record.id}}', ...output },
      });
      const saved = await admin
        .put(`/api/workflows/${wf.id}/draft`)
        .send({
          definition: {
            trigger: { type: 'MANUAL', object: 'company' },
            steps: [
              step('a', { object: 'unicorn', field: 'x' }),
              step('b', { object: 'company', field: 'employees' }),
              step('c', { object: 'company', field: 'industry' }, ['FINANCE', 'SPACE']),
              step('d', { object: 'company', field: 'industry' }, ['FINANCE', 'RETAIL']),
            ],
          },
        })
        .expect(200);
      expect(saved.body.problems).toEqual([
        'AI a: object "unicorn" doesn’t exist',
        'AI b: Company has no text or select field "employees"',
        'AI c: Industry has no option "SPACE"',
      ]);
    });
  });
});
