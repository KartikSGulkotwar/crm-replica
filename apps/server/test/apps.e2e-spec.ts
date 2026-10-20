import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;

const deal: { fields: Record<string, unknown>[]; [key: string]: unknown } = {
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  icon: 'handshake',
  fields: [
    { name: 'name', label: 'Name', type: 'TEXT', isRequired: true },
    { name: 'amount', label: 'Amount', type: 'CURRENCY' },
    {
      name: 'stage',
      label: 'Stage',
      type: 'SELECT',
      options: ['Lead', 'Negotiation', 'Won', 'Lost'],
      defaultValue: 'LEAD',
    },
    { name: 'closeDate', label: 'Close Date', type: 'DATE_TIME' },
    {
      name: 'company',
      label: 'Company',
      type: 'RELATION',
      relation: { targetObject: 'company', inverseName: 'deals' },
    },
  ],
};
const views = [
  {
    name: 'Deal pipeline',
    object: 'deals',
    type: 'KANBAN',
    kanbanField: 'stage',
    fields: ['name', 'amount', 'company'],
  },
  {
    name: 'Big deals',
    object: 'deals',
    filters: [{ field: 'amount', op: 'gte', value: 50000 }],
    sorts: [{ field: 'amount', direction: 'desc' }],
  },
];
const manifest = (overrides: Record<string, unknown> = {}) => ({
  name: 'sales-app',
  objects: [deal],
  views,
  ...overrides,
});

describe('API keys and objects-as-code (e2e)', () => {
  let t: TestApp;
  let admin: Agent;
  let key: string;
  let schema: string;
  const bearer = () => ({ Authorization: `Bearer ${key}` });
  const apply = (body: Record<string, unknown>) =>
    t.http().post('/api/metadata/apply').set(bearer()).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    const signup = await signupAgent(t, { workspaceName: 'Apps Co' });
    admin = signup.agent;
    schema = `workspace_${signup.session.workspace.id.replace(/-/g, '')}`;
  });

  afterAll(() => t?.close());

  describe('API keys', () => {
    it('creates a key that is shown once and stored only as a hash', async () => {
      const res = await admin.post('/api/api-keys').send({ name: 'CLI' }).expect(201);
      key = res.body.key;
      expect(key).toMatch(/^crm_[A-Za-z0-9_-]{32}$/);
      expect(res.body.prefix).toBe(key.slice(0, 12));
      const [row] = await t.dataSource.query(`SELECT key_hash FROM core.api_key WHERE id = $1`, [
        res.body.id,
      ]);
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key_hash).not.toContain(key.slice(4));
      const list = (await admin.get('/api/api-keys').expect(200)).body;
      expect(list).toEqual([
        expect.objectContaining({
          name: 'CLI',
          prefix: res.body.prefix,
          createdBy: expect.objectContaining({ name: 'Ada Admin' }),
        }),
      ]);
      expect(list[0]).not.toHaveProperty('key');
    });

    it('authenticates API requests with a Bearer key', async () => {
      const me = await t.http().get('/api/auth/me').set(bearer()).expect(200);
      expect(me.body.workspace.name).toBe('Apps Co');
      await t
        .http()
        .post('/api/objects/companies')
        .set(bearer())
        .send({ name: 'Acme' })
        .expect(201);
      const [row] = await t.dataSource.query(
        `SELECT last_used_at FROM core.api_key WHERE key_prefix = $1`,
        [key.slice(0, 12)],
      );
      expect(row.last_used_at).not.toBeNull();
    });

    it('rejects wrong, malformed and revoked keys', async () => {
      await t.http().get('/api/auth/me').set({ Authorization: 'Bearer crm_wrong' }).expect(401);
      await t.http().get('/api/auth/me').set({ Authorization: 'Basic abc' }).expect(401);
      const temp = (await admin.post('/api/api-keys').send({ name: 'Temp' }).expect(201)).body;
      await t
        .http()
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${temp.key}` })
        .expect(200);
      await admin.delete(`/api/api-keys/${temp.id}`).expect(204);
      const res = await t
        .http()
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${temp.key}` })
        .expect(401);
      expect(res.body.message).toBe('Invalid or revoked API key');
    });

    it('is admin-only and scoped to the workspace', async () => {
      const link = await admin.get('/api/workspace/invite-link').expect(200);
      const member = request.agent(t.app.getHttpServer());
      await member
        .post(`/api/invites/${link.body.token}/accept`)
        .send({ name: 'Mo', email: uniqueEmail(), password: 'password123' })
        .expect(201);
      await member.get('/api/api-keys').expect(403);
      await member.post('/api/api-keys').send({ name: 'Mine' }).expect(403);
      const other = await signupAgent(t, { workspaceName: 'Other' });
      expect((await other.agent.get('/api/api-keys').expect(200)).body).toEqual([]);
      const theirKey = (
        await other.agent.post('/api/api-keys').send({ name: 'Theirs' }).expect(201)
      ).body;
      const me = await t
        .http()
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${theirKey.key}` })
        .expect(200);
      expect(me.body.workspace.name).toBe('Other');
    });
  });

  describe('POST /api/metadata/apply', () => {
    it('dry run returns the plan without changing anything', async () => {
      const res = await apply({ manifest: manifest(), dryRun: true }).expect(200);
      expect(res.body).toMatchObject({
        app: 'sales-app',
        dryRun: true,
        applied: false,
        errors: [],
      });
      expect(res.body.changes.map((c: { kind: string }) => c.kind)).toEqual([
        'createObject',
        'createField',
        'createView',
        'createView',
      ]);
      expect(res.body.changes[0]).not.toHaveProperty('payload');
      await admin.get('/api/metadata/objects/deal').expect(404);
    });

    it('push creates the object, its table, relations and views in one go', async () => {
      const res = await apply({ manifest: manifest() }).expect(200);
      expect(res.body.applied).toBe(true);
      const object = (await admin.get('/api/metadata/objects/deal').expect(200)).body;
      expect(object).toMatchObject({ managedByApp: 'sales-app', icon: 'handshake' });
      expect(
        object.fields.map((f: { name: string; managedByApp: string }) => [f.name, f.managedByApp]),
      ).toEqual([
        ['name', 'sales-app'],
        ['amount', 'sales-app'],
        ['stage', 'sales-app'],
        ['closeDate', 'sales-app'],
        ['company', 'sales-app'],
      ]);
      const company = (await admin.get('/api/metadata/objects/company').expect(200)).body;
      expect(company.inverseRelations.map((r: { name: string }) => r.name)).toContain('deals');
      const dealViews = (await admin.get('/api/views').query({ object: 'deals' }).expect(200)).body;
      const pipeline = dealViews.find((v: { name: string }) => v.name === 'Deal pipeline');
      expect(pipeline).toMatchObject({
        type: 'KANBAN',
        kanbanFieldName: 'stage',
        managedByApp: 'sales-app',
      });
      expect(
        pipeline.fields
          .filter((f: { isVisible: boolean }) => f.isVisible)
          .map((f: { fieldName: string }) => f.fieldName),
      ).toEqual(['name', 'amount', 'company']);
      // The records API works on it immediately.
      const created = await t
        .http()
        .post('/api/objects/deals')
        .set(bearer())
        .send({ name: 'First deal', amount: { amount: 60000 } })
        .expect(201);
      expect(created.body.stage).toBe('LEAD');
    });

    it('pushing the same app again changes nothing', async () => {
      const res = await apply({ manifest: manifest(), dryRun: true }).expect(200);
      expect(res.body.changes).toEqual([]);
    });

    it('applies label and option changes without touching data', async () => {
      const changed = structuredClone(deal);
      changed.labelPlural = 'Pipeline deals';
      changed.fields[2] = {
        ...changed.fields[2],
        options: ['Lead', 'Negotiation', 'Won', 'Lost', 'On hold'],
      };
      const res = await apply({ manifest: manifest({ objects: [changed] }) }).expect(200);
      expect(res.body.changes.map((c: { summary: string }) => c.summary)).toEqual([
        'Update object deal',
        'Update field deal.stage',
      ]);
      const object = (await admin.get('/api/metadata/objects/deal').expect(200)).body;
      expect(object.labelPlural).toBe('Pipeline deals');
      const deals = (await t.http().get('/api/objects/deals').set(bearer()).expect(200)).body;
      expect(deals.totalCount).toBe(1);
    });

    it('refuses destructive changes unless allowed, and applies nothing', async () => {
      const shrunk = structuredClone(deal);
      shrunk.fields = shrunk.fields.filter((f) => f.name !== 'closeDate');
      shrunk.fields[1] = { name: 'amount', label: 'Amount', type: 'NUMBER' };
      const refused = await apply({ manifest: manifest({ objects: [shrunk] }) }).expect(409);
      expect(refused.body.message).toContain('--allow-destructive');
      expect(
        refused.body.result.changes.filter((c: { destructive: boolean }) => c.destructive),
      ).toHaveLength(2);
      const cols = async () =>
        (
          await t.dataSource.query(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'deals'`,
            [schema],
          )
        ).map((r: { column_name: string }) => r.column_name);
      expect(await cols()).toEqual(expect.arrayContaining(['close_date', 'amount_amount']));

      await apply({ manifest: manifest({ objects: [shrunk] }), allowDestructive: true }).expect(
        200,
      );
      expect(await cols()).not.toContain('close_date');
      expect(await cols()).toContain('amount');
    });

    it('never removes fields added in the UI, and adopts UI-made objects', async () => {
      const object = (await admin.get('/api/metadata/objects/deal').expect(200)).body;
      await admin
        .post(`/api/metadata/objects/${object.id}/fields`)
        .send({ label: 'Notes', type: 'TEXT' })
        .expect(201);
      await admin
        .post('/api/metadata/objects')
        .send({
          nameSingular: 'partner',
          namePlural: 'partners',
          labelSingular: 'Partner',
          labelPlural: 'Partners',
        })
        .expect(201);
      const partner = {
        nameSingular: 'partner',
        namePlural: 'partners',
        labelSingular: 'Partner',
        labelPlural: 'Partners',
        fields: [{ name: 'name', label: 'Name', type: 'TEXT' }],
      };
      const res = await apply({
        manifest: manifest({ objects: [deal, partner] }),
        allowDestructive: true,
      }).expect(200);
      expect(res.body.changes.map((c: { summary: string }) => c.summary)).not.toContain(
        'Remove field deal.notes; its values are deleted',
      );
      expect((await admin.get('/api/metadata/objects/partner').expect(200)).body.managedByApp).toBe(
        'sales-app',
      );
      expect(
        (await admin.get('/api/metadata/objects/deal').expect(200)).body.fields.map(
          (f: { name: string }) => f.name,
        ),
      ).toContain('notes');
    });

    it('rolls everything back when one change fails', async () => {
      const bad = {
        nameSingular: 'ticket',
        namePlural: 'tickets',
        labelSingular: 'Ticket',
        labelPlural: 'Tickets',
        fields: [{ name: 'name', label: 'Name', type: 'TEXT' }],
      };
      // The view references a field that doesn't exist, so the last change fails.
      const res = await apply({
        manifest: manifest({
          objects: [deal, bad],
          views: [...views, { name: 'Broken', object: 'tickets', sorts: [{ field: 'nope' }] }],
        }),
        allowDestructive: true,
      }).expect(400);
      expect(res.body.message).toContain('Create table view "Broken" on ticket');
      await admin.get('/api/metadata/objects/ticket').expect(404);
      const tables = await t.dataSource.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'tickets'`,
        [schema],
      );
      expect(tables).toHaveLength(0);
    });

    it('reports impossible manifests and invalid input', async () => {
      const renamed = { ...deal, namePlural: 'dealz' };
      const res = await apply({ manifest: manifest({ objects: [renamed] }), dryRun: true }).expect(
        200,
      );
      expect(res.body.errors).toEqual([
        'deal: its plural name is "deals" and can’t be changed to "dealz"',
      ]);
      await apply({ manifest: manifest({ objects: [renamed] }) }).expect(400);
      const invalid = await apply({ manifest: { name: 'Sales App', objects: [] } }).expect(400);
      expect(invalid.body.message[0]).toContain('App names use lowercase');
    });

    it('pushes workflows as code: publishes, re-pushes as no-op, republishes changes, removes', async () => {
      const won = {
        name: 'Deal won follow-up',
        trigger: {
          type: 'RECORD_UPDATED',
          object: 'deal',
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
      };
      const first = await apply({
        manifest: manifest({ workflows: [won] }),
        allowDestructive: true,
      }).expect(200);
      expect(first.body.changes.map((c: { kind: string }) => c.kind)).toContain('createWorkflow');
      const wf = (await admin.get('/api/workflows').expect(200)).body.find(
        (w: { name: string }) => w.name === 'Deal won follow-up',
      );
      expect(wf).toMatchObject({
        isActive: true,
        managedByApp: 'sales-app',
        activeVersion: { version: 1 },
      });

      expect(
        (
          await apply({ manifest: manifest({ workflows: [won] }), dryRun: true }).expect(200)
        ).body.changes.filter((c: { kind: string }) => c.kind.includes('Workflow')),
      ).toEqual([]);

      const changed = {
        ...won,
        steps: [{ ...won.steps[0], values: { title: 'Celebrate {{trigger.record.name}}' } }],
      };
      const second = await apply({
        manifest: manifest({ workflows: [changed] }),
        allowDestructive: true,
      }).expect(200);
      expect(second.body.changes.map((c: { summary: string }) => c.summary)).toContain(
        'Update workflow "Deal won follow-up"',
      );
      expect(
        (await admin.get(`/api/workflows/${wf.id}`).expect(200)).body.activeVersion.version,
      ).toBe(2);

      // A broken workflow (unknown object) fails the whole push and changes nothing.
      const broken = {
        ...won,
        name: 'Broken',
        trigger: { type: 'RECORD_CREATED', object: 'unicorn' },
      };
      const failed = await apply({
        manifest: manifest({ workflows: [changed, broken] }),
        allowDestructive: true,
      }).expect(400);
      expect(failed.body.message).toContain('Create and publish workflow "Broken"');
      expect(
        (await admin.get('/api/workflows').expect(200)).body.map((w: { name: string }) => w.name),
      ).not.toContain('Broken');

      const removal = await apply({ manifest: manifest({ workflows: [] }) }).expect(409);
      expect(removal.body.result.changes).toContainEqual(
        expect.objectContaining({ kind: 'removeWorkflow', destructive: true }),
      );
      await apply({ manifest: manifest({ workflows: [] }), allowDestructive: true }).expect(200);
      await admin.get(`/api/workflows/${wf.id}`).expect(404);
    });

    it('removes what the app no longer declares', async () => {
      const res = await apply({
        manifest: { name: 'sales-app', objects: [], views: [] },
        allowDestructive: true,
      }).expect(200);
      // (partner was already removed by the workflow test's pushes, which didn't declare it)
      expect(
        res.body.changes.map((c: { kind: string; object: string }) => `${c.kind} ${c.object}`),
      ).toEqual(['removeObject deal']);
      expect(
        (await admin.get('/api/views').query({ object: 'companies' }).expect(200)).body.length,
      ).toBeGreaterThan(0);
      await admin.get('/api/metadata/objects/deal').expect(404);
    });

    it('is admin-only', async () => {
      await t
        .http()
        .post('/api/metadata/apply')
        .send({ manifest: manifest(), dryRun: true })
        .expect(401);
    });
  });
});
