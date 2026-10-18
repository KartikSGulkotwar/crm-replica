import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { RecordEvent } from '../src/events/record-events';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;

describe('Records API (e2e)', () => {
  let t: TestApp;
  let admin: Agent;
  let adminId: string;
  let schema: string;
  const events: RecordEvent[] = [];

  const list = async (plural: string, query: Record<string, string | number> = {}) =>
    (await admin.get(`/api/objects/${plural}`).query(query).expect(200)).body;
  const filtered = async (plural: string, filter: unknown, extra: Record<string, string> = {}) =>
    list(plural, { filter: JSON.stringify(filter), limit: 200, ...extra });
  const create = async (plural: string, body: unknown) =>
    (
      await admin
        .post(`/api/objects/${plural}`)
        .send(body as object)
        .expect(201)
    ).body;

  beforeAll(async () => {
    t = await createTestApp();
    const signup = await signupAgent(t, { workspaceName: 'Records Co' });
    admin = signup.agent;
    adminId = signup.session.user.id;
    schema = `workspace_${signup.session.workspace.id.replace(/-/g, '')}`;
    for (const name of ['record.created', 'record.updated', 'record.deleted', 'record.restored']) {
      t.app.get(EventEmitter2).on(name, (e: RecordEvent) => events.push(e));
    }
  });

  afterAll(() => t?.close());

  describe('CRUD', () => {
    let acmeId: string;

    it('creates a record with defaults, system fields and created_by', async () => {
      const acme = await create('companies', {
        name: 'Acme',
        domain: 'acme.com',
        employees: 120,
        industry: 'SOFTWARE',
        annualRevenue: { amount: 2500000 },
      });
      acmeId = acme.id;
      expect(acme).toMatchObject({
        name: 'Acme',
        domain: 'acme.com',
        employees: 120,
        industry: 'SOFTWARE',
        annualRevenue: { amount: 2500000, currency: 'USD' },
        createdBy: adminId,
        position: 1,
      });
      const deal = await create('opportunities', { name: 'Acme renewal', companyId: acmeId });
      expect(deal.stage).toBe('NEW'); // the field's default
      expect(deal.position).toBe(1);
      expect((await create('companies', { name: 'Second' })).position).toBe(2); // appended to the end
    });

    it('gets, updates only what is sent, and records updatedAt', async () => {
      const before = (await admin.get(`/api/objects/companies/${acmeId}`).expect(200)).body;
      const updated = (
        await admin.patch(`/api/objects/companies/${acmeId}`).send({ employees: 150 }).expect(200)
      ).body;
      expect(updated).toMatchObject({ name: 'Acme', employees: 150, domain: 'acme.com' });
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before.updatedAt).getTime(),
      );
    });

    it('returns every validation problem at once', async () => {
      const res = await admin
        .post('/api/objects/companies')
        .send({
          employees: 'lots',
          industry: 'MINING',
          domain: 'not a domain',
          createdAt: '2020-01-01',
          nope: 1,
        })
        .expect(400);
      expect(res.body.message).toEqual([
        'employees must be a number',
        expect.stringContaining('industry must be one of: SOFTWARE'),
        'domain must be a valid web address',
        'createdAt is set automatically and can’t be changed',
        'Unknown field "nope" on Company',
      ]);
    });

    it('rejects links to records that don’t exist (or are deleted)', async () => {
      const res = await admin
        .post('/api/objects/people')
        .send({ firstName: 'Ghost', companyId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
        .expect(400);
      expect(res.body.message).toEqual([
        'companyId: no company with id 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      ]);
    });

    it('soft-deletes (hidden but kept) and restores', async () => {
      const temp = await create('companies', { name: 'Temp' });
      await admin.delete(`/api/objects/companies/${temp.id}`).expect(200);
      await admin.get(`/api/objects/companies/${temp.id}`).expect(404);
      expect((await list('companies')).data.map((c: { name: string }) => c.name)).not.toContain(
        'Temp',
      );
      const [row] = await t.dataSource.query(
        `SELECT deleted_at FROM "${schema}"."companies" WHERE id = $1`,
        [temp.id],
      );
      expect(row.deleted_at).not.toBeNull();

      await admin.post(`/api/objects/companies/${temp.id}/restore`).expect(200);
      await admin.get(`/api/objects/companies/${temp.id}`).expect(200);
      await admin.delete(`/api/objects/companies/${temp.id}`).expect(200);
      await admin.delete(`/api/objects/companies/${temp.id}`).expect(404); // already deleted
    });

    it('deletes several records at once, skipping ones already deleted', async () => {
      const a = await create('companies', { name: 'Batch A' });
      const b = await create('companies', { name: 'Batch B' });
      await admin.delete(`/api/objects/companies/${b.id}`).expect(200);
      const res = await admin
        .post('/api/objects/companies/batch-delete')
        .send({ ids: [a.id, b.id] })
        .expect(200);
      expect(res.body.deletedIds).toEqual([a.id]);
      await admin.get(`/api/objects/companies/${a.id}`).expect(404);
      await admin.post('/api/objects/companies/batch-delete').send({ ids: [] }).expect(400);
      await admin
        .post('/api/objects/companies/batch-delete')
        .send({ ids: ["x' OR 1=1 --"] })
        .expect(400);
    });

    it('returns 404 for unknown objects and ids', async () => {
      await admin.get('/api/objects/unicorns').expect(404);
      await admin.get('/api/objects/company').expect(404); // plural only
      await admin.get('/api/objects/companies/not-a-uuid').expect(404);
      await admin.get('/api/objects/companies/3f2504e0-4f89-11d3-9a0c-0305e82c3301').expect(404);
    });

    it('works for custom objects created through the metadata API', async () => {
      const object = (
        await admin
          .post('/api/metadata/objects')
          .send({
            nameSingular: 'deal',
            namePlural: 'deals',
            labelSingular: 'Deal',
            labelPlural: 'Deals',
            fields: [
              { label: 'Name', type: 'TEXT', isRequired: true },
              { label: 'Tags', type: 'MULTI_SELECT', options: ['Hot', 'Cold'] },
              { label: 'Signed at', type: 'DATE_TIME' },
            ],
          })
          .expect(201)
      ).body;
      expect(object.nameSingular).toBe('deal');
      const deal = await create('deals', {
        name: 'D1',
        tags: ['HOT'],
        signedAt: '2026-05-01T12:00:00-05:00',
      });
      expect(deal).toMatchObject({
        name: 'D1',
        tags: ['HOT'],
        signedAt: '2026-05-01T17:00:00.000Z',
      });
      const missing = await admin.post('/api/objects/deals').send({ tags: [] }).expect(400);
      expect(missing.body.message).toEqual(['name is required']);
    });
  });

  describe('filters', () => {
    beforeAll(async () => {
      const rows = [
        { name: 'Filter Alpha', employees: 10, industry: 'FINANCE', domain: 'alpha.io' },
        { name: 'Filter Beta', employees: 500, industry: 'SOFTWARE' },
        { name: 'Filter Gamma', employees: null, industry: null },
        { name: '100% Filter_Delta', employees: 50, industry: 'RETAIL' },
      ];
      for (const r of rows) await create('companies', r);
    });

    const names = (res: { data: { name: string }[] }) => res.data.map((r) => r.name).sort();

    it.each([
      [
        { field: 'name', op: 'startsWith', value: 'Filter' },
        ['Filter Alpha', 'Filter Beta', 'Filter Gamma'],
      ],
      [{ field: 'name', op: 'contains', value: 'beta' }, ['Filter Beta']], // case-insensitive
      [{ field: 'name', op: 'contains', value: '%' }, ['100% Filter_Delta']], // % is literal
      [{ field: 'name', op: 'contains', value: 'r_D' }, ['100% Filter_Delta']], // _ is literal
      [
        {
          and: [
            { field: 'name', op: 'contains', value: 'filter' },
            { field: 'employees', op: 'gte', value: 50 },
          ],
        },
        ['100% Filter_Delta', 'Filter Beta'],
      ],
      [
        {
          and: [
            { field: 'name', op: 'contains', value: 'filter' },
            {
              or: [
                { field: 'industry', op: 'eq', value: 'FINANCE' },
                { field: 'employees', op: 'isEmpty' },
              ],
            },
          ],
        },
        ['Filter Alpha', 'Filter Gamma'],
      ],
      [
        {
          and: [
            { field: 'name', op: 'contains', value: 'filter' },
            { field: 'industry', op: 'notIn', value: ['SOFTWARE'] },
          ],
        },
        ['100% Filter_Delta', 'Filter Alpha', 'Filter Gamma'], // notIn keeps empty values
      ],
      [
        {
          and: [
            { field: 'name', op: 'contains', value: 'filter' },
            { not: { field: 'domain', op: 'isEmpty' } },
          ],
        },
        ['Filter Alpha'],
      ],
    ])('%j', async (filter, expected) => {
      expect(names(await filtered('companies', filter))).toEqual(expected);
    });

    it('filters by relation and by created date', async () => {
      const acme = (await filtered('companies', { field: 'name', op: 'eq', value: 'Acme' }))
        .data[0];
      const deals = await filtered('opportunities', { field: 'company', op: 'eq', value: acme.id });
      expect(deals.data.map((d: { name: string }) => d.name)).toEqual(['Acme renewal']);
      const recent = await filtered('companies', {
        field: 'createdAt',
        op: 'gte',
        value: '2000-01-01',
      });
      expect(recent.totalCount).toBeGreaterThanOrEqual(6);
    });

    it('reports bad filters as 400 with a helpful message', async () => {
      const bad = async (filter: string) =>
        (await admin.get('/api/objects/companies').query({ filter }).expect(400)).body.message;
      expect(await bad('{"field":"nope","op":"eq","value":1}')).toBe(
        'Unknown field "nope" on Company',
      );
      expect(await bad('{"field":"name","op":"gt","value":"a"}')).toContain(
        'Operator "gt" isn’t supported for Name (Text)',
      );
      expect(await bad('not json')).toContain('valid JSON');
    });

    describe('SQL injection attempts change nothing', () => {
      it.each([
        `'; DROP TABLE companies; --`,
        `' OR '1'='1`,
        `x' UNION SELECT id, password_hash FROM core."user" --`,
        `\\'; SELECT pg_sleep(5); --`,
      ])('value %j is treated as plain text', async (payload) => {
        for (const op of ['eq', 'contains', 'startsWith']) {
          const res = await filtered('companies', { field: 'name', op, value: payload });
          expect(res.data).toEqual([]); // no company has that name
        }
        // Stored as a value, it round-trips untouched.
        const saved = await create('companies', { name: payload });
        expect(
          (await filtered('companies', { field: 'name', op: 'eq', value: payload })).data[0].id,
        ).toBe(saved.id);
        await admin.delete(`/api/objects/companies/${saved.id}`).expect(200);
      });

      it.each([
        `name" = 'x' OR 1=1 --`,
        `name"; DROP TABLE companies; --`,
        `password_hash`,
        `deleted_at`,
      ])('field %j is rejected', async (field) => {
        const res = await admin
          .get('/api/objects/companies')
          .query({ filter: JSON.stringify({ field, op: 'eq', value: 'x' }) })
          .expect(400);
        expect(res.body.message).toContain('Unknown field');
      });

      it('sort, expand and plural names can’t be abused either', async () => {
        await admin
          .get('/api/objects/companies')
          .query({ sort: 'name; DROP TABLE companies' })
          .expect(400);
        await admin
          .get('/api/objects/companies')
          .query({ sort: 'name:asc NULLS FIRST' })
          .expect(400);
        await admin
          .get('/api/objects/companies')
          .query({ expand: 'people; DROP TABLE people' })
          .expect(400);
        await admin
          .get(`/api/objects/${encodeURIComponent('companies; DROP TABLE companies')}`)
          .expect(404);
      });

      afterAll(async () => {
        // Everything is still there.
        const [{ n }] = await t.dataSource.query(
          `SELECT count(*)::int AS n FROM "${schema}"."companies"`,
        );
        expect(n).toBeGreaterThan(5);
        const [{ users }] = await t.dataSource.query(
          `SELECT count(*)::int AS users FROM core."user"`,
        );
        expect(users).toBeGreaterThan(0);
      });
    });
  });

  describe('sorting and cursor pagination', () => {
    beforeAll(async () => {
      // Duplicate and missing sort values are the hard cases for keyset pagination.
      const employees = [5, null, 5, 20, null, 1, 20, 5, null, 300, 1, 5, 20, null, 7, 7, 7];
      for (const [i, e] of employees.entries()) {
        await create('companies', {
          name: `Page ${String(i % 4)}`,
          employees: e,
          industry: i % 3 ? 'SOFTWARE' : null,
        });
      }
    });

    async function pageThrough(sort: string, limit: number) {
      const ids: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await list('companies', {
          sort,
          limit,
          filter: JSON.stringify({ field: 'name', op: 'startsWith', value: 'Page' }),
          ...(cursor ? { cursor } : {}),
        });
        ids.push(...res.data.map((r: { id: string }) => r.id));
        expect(res.totalCount).toBe(17);
        cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : undefined;
        if (++pages > 20) throw new Error('pagination did not terminate');
      } while (cursor);
      return ids;
    }

    it.each([
      'employees:desc,name:asc',
      'name:asc,employees:asc',
      'industry:asc',
      'createdAt:desc',
      'employees:asc',
    ])('visits every record exactly once in the same order as one big page (%s)', async (sort) => {
      const all = (
        await list('companies', {
          sort,
          limit: 200,
          filter: JSON.stringify({ field: 'name', op: 'startsWith', value: 'Page' }),
        })
      ).data.map((r: { id: string }) => r.id);
      expect(all).toHaveLength(17);
      for (const limit of [1, 4, 5]) expect(await pageThrough(sort, limit)).toEqual(all);
    });

    it('puts empty values last in both directions', async () => {
      const filter = JSON.stringify({ field: 'name', op: 'startsWith', value: 'Page' });
      for (const dir of ['asc', 'desc']) {
        const values = (
          await list('companies', { sort: `employees:${dir}`, limit: 200, filter })
        ).data.map((r: { employees: number | null }) => r.employees);
        expect(values.slice(-4)).toEqual([null, null, null, null]);
        const numbers = values.slice(0, -4);
        expect(numbers).toEqual(
          [...numbers].sort((a: number, b: number) => (dir === 'asc' ? a - b : b - a)),
        );
      }
    });

    it('sorts select fields by option order, not alphabetically', async () => {
      for (const stage of ['WON', 'NEW', 'PROPOSAL', 'QUALIFIED'])
        await create('opportunities', { name: `Stage ${stage}`, stage });
      const res = await filtered(
        'opportunities',
        { field: 'name', op: 'startsWith', value: 'Stage' },
        { sort: 'stage:asc' },
      );
      expect(res.data.map((r: { stage: string }) => r.stage)).toEqual([
        'NEW',
        'QUALIFIED',
        'PROPOSAL',
        'WON',
      ]);
    });

    it('rejects a cursor used with a different sort, and bad limits', async () => {
      const first = await list('companies', { sort: 'name', limit: 2 });
      const res = await admin
        .get('/api/objects/companies')
        .query({ sort: 'employees', cursor: first.pageInfo.endCursor })
        .expect(400);
      expect(res.body.message).toContain('different sort');
      await admin.get('/api/objects/companies').query({ limit: 0 }).expect(400);
      await admin.get('/api/objects/companies').query({ limit: 201 }).expect(400);
    });
  });

  describe('expand', () => {
    let globex: { id: string };

    beforeAll(async () => {
      globex = await create('companies', { name: 'Globex' });
      const hank = await create('people', {
        firstName: 'Hank',
        lastName: 'Scorpio',
        companyId: globex.id,
      });
      await create('people', { firstName: 'Homer', companyId: globex.id });
      await create('opportunities', {
        name: 'Globex doomsday',
        companyId: globex.id,
        pointOfContactId: hank.id,
      });
    });

    it('expands a many-to-one relation into the linked record', async () => {
      const res = await filtered(
        'opportunities',
        { field: 'name', op: 'eq', value: 'Globex doomsday' },
        { expand: 'company,pointOfContact' },
      );
      expect(res.data[0].company).toMatchObject({ id: globex.id, name: 'Globex' });
      expect(res.data[0].pointOfContact).toMatchObject({ firstName: 'Hank' });
      expect(res.data[0].companyId).toBe(globex.id);
    });

    it('expands the reverse side into a list', async () => {
      const company = (
        await admin
          .get(`/api/objects/companies/${globex.id}`)
          .query({ expand: 'people,opportunities' })
          .expect(200)
      ).body;
      expect(company.people.map((p: { firstName: string }) => p.firstName)).toEqual([
        'Hank',
        'Homer',
      ]);
      expect(company.opportunities.map((o: { name: string }) => o.name)).toEqual([
        'Globex doomsday',
      ]);
    });

    it('shows deleted linked records as null', async () => {
      const temp = await create('companies', { name: 'Short-lived' });
      const person = await create('people', { firstName: 'Orphan', companyId: temp.id });
      await admin.delete(`/api/objects/companies/${temp.id}`).expect(200);
      const res = (
        await admin.get(`/api/objects/people/${person.id}`).query({ expand: 'company' }).expect(200)
      ).body;
      expect(res.company).toBeNull();
    });

    it('explains what can be expanded', async () => {
      const res = await admin.get('/api/objects/companies').query({ expand: 'nope' }).expect(400);
      expect(res.body.message).toBe('Can’t expand "nope" on Company; try: people, opportunities');
    });
  });

  describe('events', () => {
    it('emits created / updated (with changed fields) / deleted / restored', async () => {
      events.length = 0;
      const c = await create('companies', { name: 'Evented' });
      await admin
        .patch(`/api/objects/companies/${c.id}`)
        .send({ name: 'Evented', employees: 3 })
        .expect(200);
      await admin.patch(`/api/objects/companies/${c.id}`).send({ employees: 3 }).expect(200); // no change → no event
      await admin.delete(`/api/objects/companies/${c.id}`).expect(200);
      await admin.post(`/api/objects/companies/${c.id}/restore`).expect(200);

      expect(events.map((e) => e.name)).toEqual([
        'record.created',
        'record.updated',
        'record.deleted',
        'record.restored',
      ]);
      expect(events[0]).toMatchObject({
        objectName: 'company',
        recordId: c.id,
        actorUserId: adminId,
        depth: 0,
      });
      expect(events[1].changedFields).toEqual(['employees']);
      expect(events[1].before).toMatchObject({ employees: null });
      expect(events[1].record).toMatchObject({ employees: 3 });
    });
  });

  describe('permissions and isolation', () => {
    it('lets members work with records', async () => {
      const link = await admin.get('/api/workspace/invite-link').expect(200);
      const member = request.agent(t.app.getHttpServer());
      await member
        .post(`/api/invites/${link.body.token}/accept`)
        .send({ name: 'Mo', email: uniqueEmail('mo'), password: 'password123' })
        .expect(201);
      const created = (
        await member.post('/api/objects/companies').send({ name: 'By member' }).expect(201)
      ).body;
      await member.patch(`/api/objects/companies/${created.id}`).send({ employees: 2 }).expect(200);
      await member.delete(`/api/objects/companies/${created.id}`).expect(200);
    });

    it('keeps workspace members read-only', async () => {
      const members = await list('workspaceMembers');
      expect(members.data.map((m: { name: string }) => m.name)).toContain('Ada Admin');
      const res = await admin
        .post('/api/objects/workspaceMembers')
        .send({ name: 'Fake' })
        .expect(403);
      expect(res.body.message).toContain('read-only');
      await admin
        .patch(`/api/objects/workspaceMembers/${adminId}`)
        .send({ name: 'Renamed' })
        .expect(403);
    });

    it('never shows another workspace’s records', async () => {
      const acme = (await filtered('companies', { field: 'name', op: 'eq', value: 'Acme' }))
        .data[0];
      const other = await signupAgent(t, { workspaceName: 'Other' });
      expect((await other.agent.get('/api/objects/companies').expect(200)).body.totalCount).toBe(0);
      await other.agent.get(`/api/objects/companies/${acme.id}`).expect(404);
      await other.agent
        .patch(`/api/objects/companies/${acme.id}`)
        .send({ name: 'Stolen' })
        .expect(404);
      await other.agent.delete(`/api/objects/companies/${acme.id}`).expect(404);
      // Linking to a record from another workspace fails too.
      await other.agent
        .post('/api/objects/people')
        .send({ firstName: 'Spy', companyId: acme.id })
        .expect(400);
      await admin.get(`/api/objects/companies/${acme.id}`).expect(200);
    });

    it('requires a session', async () => {
      await t.http().get('/api/objects/companies').expect(401);
      await t.http().post('/api/objects/companies').send({ name: 'x' }).expect(401);
    });
  });

  describe('live API docs', () => {
    it('lists your workspace’s objects, fields and options when logged in', async () => {
      const doc = (await admin.get('/api/openapi.json').expect(200)).body;
      expect(doc.paths).toHaveProperty('/api/objects/companies');
      expect(doc.paths).toHaveProperty('/api/objects/deals/{id}');
      expect(doc.paths).not.toHaveProperty('/api/objects/{plural}');
      expect(doc.paths['/api/objects/workspaceMembers']).not.toHaveProperty('post'); // read-only
      expect(doc.components.schemas.Opportunity.properties.stage.enum).toEqual([
        'NEW',
        'QUALIFIED',
        'PROPOSAL',
        'WON',
        'LOST',
      ]);
      expect(doc.components.schemas.Person.properties.companyId).toMatchObject({ format: 'uuid' });
    });

    it('updates as soon as the data model changes', async () => {
      const company = (await admin.get('/api/metadata/objects/company').expect(200)).body;
      await admin
        .post(`/api/metadata/objects/${company.id}/fields`)
        .send({ label: 'Churn risk', type: 'RATING' })
        .expect(201);
      const doc = (await admin.get('/api/openapi.json').expect(200)).body;
      expect(doc.components.schemas.Company.properties.churnRisk).toMatchObject({
        type: 'integer',
        maximum: 5,
      });
    });

    it('shows the generic endpoints when logged out', async () => {
      const doc = (await t.http().get('/api/openapi.json').expect(200)).body;
      expect(doc.paths).toHaveProperty('/api/objects/{plural}');
      expect(doc.paths).not.toHaveProperty('/api/objects/companies');
    });
  });
});
