import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;

describe('Views API (e2e)', () => {
  let t: TestApp;
  let admin: Agent;

  beforeAll(async () => {
    t = await createTestApp();
    admin = (await signupAgent(t, { workspaceName: 'Views Co' })).agent;
  });

  afterAll(() => t?.close());

  it('creates one default view per object on first request, listing every field', async () => {
    const [first, again] = await Promise.all([
      admin.get('/api/views').query({ object: 'companies' }).expect(200),
      admin.get('/api/views').query({ object: 'companies' }).expect(200),
    ]);
    expect(first.body).toHaveLength(1);
    expect(again.body[0].id).toBe(first.body[0].id);
    expect(first.body[0]).toMatchObject({
      name: 'All companies',
      type: 'TABLE',
      isDefault: true,
      filters: [],
      sorts: [],
    });
    expect(first.body[0].fields.map((f: { fieldName: string }) => f.fieldName)).toEqual([
      'name',
      'domain',
      'employees',
      'industry',
      'annualRevenue',
    ]);
  });

  it('saves filters, sorts, field order, visibility and widths', async () => {
    const created = await admin
      .post('/api/views')
      .send({
        object: 'opportunities',
        name: 'Big deals',
        filters: [{ fieldName: 'amount', operator: 'gte', value: 50000 }],
        sorts: [{ fieldName: 'closeDate', direction: 'asc' }],
        fields: [
          { fieldName: 'name', width: 260 },
          { fieldName: 'amount' },
          { fieldName: 'stage', isVisible: false },
        ],
      })
      .expect(201);
    const view = (await admin.get(`/api/views/${created.body.id}`).expect(200)).body;
    expect(view.filters).toEqual([{ fieldName: 'amount', operator: 'gte', value: 50000 }]);
    expect(view.sorts).toEqual([{ fieldName: 'closeDate', direction: 'asc' }]);
    expect(view.fields.slice(0, 3)).toEqual([
      { fieldName: 'name', isVisible: true, width: 260, position: 0 },
      { fieldName: 'amount', isVisible: true, width: null, position: 1 },
      { fieldName: 'stage', isVisible: false, width: null, position: 2 },
    ]);
    // Fields not mentioned are appended (visible), so nothing silently disappears.
    expect(view.fields.map((f: { fieldName: string }) => f.fieldName)).toContain('pointOfContact');

    const updated = await admin
      .patch(`/api/views/${view.id}`)
      .send({
        name: 'Biggest deals',
        filterConjunction: 'or',
        filters: [{ fieldName: 'createdAt', operator: 'gte', value: '2026-01-01' }],
      })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Biggest deals', filterConjunction: 'or' });
    expect(updated.body.sorts).toHaveLength(1); // untouched
  });

  it('switches to kanban grouped by a select field', async () => {
    const view = (
      await admin
        .post('/api/views')
        .send({ object: 'opportunities', name: 'Pipeline', type: 'KANBAN' })
        .expect(201)
    ).body;
    expect(view).toMatchObject({ type: 'KANBAN', kanbanFieldName: 'stage' }); // first select field by default
    await admin.patch(`/api/views/${view.id}`).send({ kanbanFieldName: 'name' }).expect(400);
    const notes = await admin
      .post('/api/views')
      .send({ object: 'notes', name: 'Board', type: 'KANBAN' })
      .expect(400);
    expect(notes.body.message).toBe('Notes have no select field to group a kanban by');
  });

  it.each([
    [{ filters: [{ fieldName: 'nope', operator: 'eq', value: 1 }] }, 'Unknown field "nope"'],
    [
      { filters: [{ fieldName: 'name', operator: 'gt', value: 'a' }] },
      'Operator "gt" isn’t supported',
    ],
    [{ filters: [{ fieldName: 'stage', operator: 'eq', value: 'MAYBE' }] }, 'must be one of'],
    [{ sorts: [{ fieldName: 'name; DROP TABLE x', direction: 'asc' }] }, 'camelCase'],
    [{ sorts: [{ fieldName: 'company', direction: 'asc' }] }, 'Can’t sort by Company'],
    [{ fields: [{ fieldName: 'name' }, { fieldName: 'name' }] }, 'only once'],
    [{ type: 'GALLERY' }, 'type'],
  ])('rejects invalid view %j', async (patch, message) => {
    const view = (await admin.get('/api/views').query({ object: 'opportunities' }).expect(200))
      .body[0];
    const res = await admin.patch(`/api/views/${view.id}`).send(patch).expect(400);
    expect(String(res.body.message)).toContain(message);
  });

  it('protects the default view and deletes others', async () => {
    const views = (await admin.get('/api/views').query({ object: 'opportunities' }).expect(200))
      .body;
    const def = views.find((v: { isDefault: boolean }) => v.isDefault);
    await admin.delete(`/api/views/${def.id}`).expect(400);
    const other = views.find((v: { isDefault: boolean }) => !v.isDefault);
    await admin.delete(`/api/views/${other.id}`).expect(204);
    await admin.get(`/api/views/${other.id}`).expect(404);
  });

  it('drops filters on fields that were deleted', async () => {
    const company = (await admin.get('/api/metadata/objects/company').expect(200)).body;
    const tier = (
      await admin
        .post(`/api/metadata/objects/${company.id}/fields`)
        .send({ label: 'Tier', type: 'NUMBER' })
        .expect(201)
    ).body;
    const view = (
      await admin
        .post('/api/views')
        .send({
          object: 'companies',
          name: 'Tiered',
          filters: [{ fieldName: 'tier', operator: 'gt', value: 1 }],
        })
        .expect(201)
    ).body;
    await admin.delete(`/api/metadata/fields/${tier.id}`).expect(200);
    const after = (await admin.get(`/api/views/${view.id}`).expect(200)).body;
    expect(after.filters).toEqual([]);
    expect(after.fields.map((f: { fieldName: string }) => f.fieldName)).not.toContain('tier');
  });

  it('lets members manage views, and keeps workspaces apart', async () => {
    const link = await admin.get('/api/workspace/invite-link').expect(200);
    const member = request.agent(t.app.getHttpServer());
    await member
      .post(`/api/invites/${link.body.token}/accept`)
      .send({ name: 'Mo', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    const mine = (
      await member.post('/api/views').send({ object: 'people', name: 'My people' }).expect(201)
    ).body;

    const other = await signupAgent(t, { workspaceName: 'Elsewhere' });
    await other.agent.get(`/api/views/${mine.id}`).expect(404);
    await other.agent.patch(`/api/views/${mine.id}`).send({ name: 'Hijacked' }).expect(404);
    await other.agent.delete(`/api/views/${mine.id}`).expect(404);
  });
});
