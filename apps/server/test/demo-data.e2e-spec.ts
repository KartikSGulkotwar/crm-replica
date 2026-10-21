import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

jest.setTimeout(60_000);

describe('Demo data (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('fills a workspace once, without setting off workflows', async () => {
    const { agent: admin } = await signupAgent(t, { workspaceName: 'Demo Co' });
    // A workflow that would fire on every new company.
    const wf = (await admin.post('/api/workflows').send({ name: 'On company' }).expect(201)).body;
    await admin
      .put(`/api/workflows/${wf.id}/draft`)
      .send({
        definition: {
          trigger: { type: 'RECORD_CREATED', object: 'company' },
          steps: [{ id: 'mail', name: 'Mail', type: 'SEND_EMAIL', to: 'a@b.co', subject: 'x' }],
        },
      })
      .expect(200);
    await admin.post(`/api/workflows/${wf.id}/publish`).expect(200);

    expect((await admin.get('/api/demo-data').expect(200)).body).toEqual({ loadedAt: null });
    const res = await admin.post('/api/demo-data').expect(201);
    expect(res.body).toEqual({
      companies: 30,
      people: 60,
      opportunities: 40,
      notes: 24,
      tasks: 30,
    });
    expect((await admin.get('/api/demo-data').expect(200)).body.loadedAt).toEqual(
      expect.any(String),
    );

    const total = async (plural: string) =>
      (await admin.get(`/api/objects/${plural}?limit=1`).expect(200)).body.totalCount;
    expect(await total('companies')).toBe(30);
    expect(await total('people')).toBe(60);
    expect(await total('opportunities')).toBe(40);

    // Linked notes and tasks show on record pages, with a timeline entry from "demo".
    const deal = (
      await admin.get('/api/objects/opportunities?limit=1&sort=createdAt:asc').expect(200)
    ).body.data[0];
    const activities = (
      await admin.get(`/api/objects/opportunities/${deal.id}/activities`).expect(200)
    ).body;
    expect(activities.notes.length + activities.tasks.length).toBeGreaterThan(0);
    const events = (await admin.get(`/api/objects/opportunities/${deal.id}/timeline`).expect(200))
      .body.data;
    expect(events.at(-1)).toMatchObject({ kind: 'created', source: 'demo' });

    expect((await admin.get(`/api/workflows/${wf.id}/runs`).expect(200)).body).toEqual([]);
    await admin.post('/api/demo-data').expect(409);
  });

  it('is admin-only', async () => {
    const { agent: admin } = await signupAgent(t);
    const link = (await admin.get('/api/workspace/invite-link').expect(200)).body;
    const member = request.agent(t.app.getHttpServer());
    await member
      .post(`/api/invites/${link.token}/accept`)
      .send({ name: 'Mo', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    await member.post('/api/demo-data').expect(403);
    await t.http().post('/api/demo-data').expect(401);
  });
});
