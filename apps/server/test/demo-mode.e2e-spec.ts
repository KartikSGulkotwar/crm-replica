import { getQueueToken } from '@nestjs/bullmq';
import { MAINTENANCE_JOBS, QUEUES } from '@crm-replica/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { DemoWorkspaceService } from '../src/demo/demo-workspace.service';
import { MaintenanceProcessor } from '../src/demo/demo-workspace.processor';
import { createTestApp, TestApp } from './utils/test-app';

jest.setTimeout(60_000);

describe('Public demo (e2e, DEMO_MODE=true)', () => {
  let t: TestApp;
  const email = `demo-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_EMAIL = email;
    process.env.DEMO_PASSWORD = 'try-the-demo';
    t = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_EMAIL;
    delete process.env.DEMO_PASSWORD;
    await t?.close();
  });

  const login = async () => {
    const agent = request.agent(t.app.getHttpServer());
    const res = await agent
      .post('/api/auth/login')
      .send({ email, password: 'try-the-demo' })
      .expect(200);
    return { agent, session: res.body };
  };

  it('publishes the demo login and builds the demo workspace on start', async () => {
    expect((await t.http().get('/api/auth/demo').expect(200)).body).toEqual({
      enabled: true,
      email,
      password: 'try-the-demo',
    });
    const { agent, session } = await login();
    expect(session).toMatchObject({
      user: { name: 'Demo User', role: 'admin' },
      workspace: { name: 'Acme Demo' },
    });
    const total = async (plural: string) =>
      (await agent.get(`/api/objects/${plural}?limit=1`).expect(200)).body.totalCount;
    expect([await total('companies'), await total('people'), await total('opportunities')]).toEqual(
      [30, 60, 40],
    );
    const views = (await agent.get('/api/views?object=opportunities').expect(200)).body;
    expect(views).toContainEqual(expect.objectContaining({ name: 'Pipeline', type: 'KANBAN' }));
    const workflows = (await agent.get('/api/workflows').expect(200)).body;
    expect(workflows).toEqual([
      expect.objectContaining({ name: 'Deal won: kickoff', isActive: true }),
    ]);
  });

  it('schedules a nightly rebuild that throws away visitors’ changes', async () => {
    const queue = t.app.get<Queue>(getQueueToken(QUEUES.MAINTENANCE));
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toContainEqual(
      expect.objectContaining({ key: 'demo-reset', pattern: '0 3 * * *', tz: 'UTC' }),
    );

    const before = await login();
    await before.agent.post('/api/objects/companies').send({ name: 'Graffiti Inc' }).expect(201);
    await before.agent.patch('/api/workspace').send({ name: 'Hacked' }).expect(200);

    // What the scheduled job does.
    await t.app.get(MaintenanceProcessor).process({ name: MAINTENANCE_JOBS.DEMO_RESET } as never);

    // The old session's user is gone; logging in again gives a fresh workspace.
    await before.agent.get('/api/auth/me').expect(401);
    const after = await login();
    expect(after.session.workspace).toMatchObject({ name: 'Acme Demo' });
    expect(after.session.workspace.id).not.toBe(before.session.workspace.id);
    const found = (
      await after.agent
        .get(
          `/api/objects/companies?filter=${encodeURIComponent(JSON.stringify({ field: 'name', op: 'eq', value: 'Graffiti Inc' }))}`,
        )
        .expect(200)
    ).body.totalCount;
    expect(found).toBe(0);
    // The old workspace's schema was dropped.
    const schemas = await t.dataSource.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [`workspace_${before.session.workspace.id.replace(/-/g, '')}`],
    );
    expect(schemas).toEqual([]);
  });

  it('two rebuilds at once still leave exactly one demo workspace', async () => {
    const demo = t.app.get(DemoWorkspaceService);
    await Promise.all([demo.reset(), demo.reset()]);
    const rows = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM core."user" WHERE email = $1`,
      [email],
    );
    expect(rows[0].n).toBe(1);
    await login();
  });
});
