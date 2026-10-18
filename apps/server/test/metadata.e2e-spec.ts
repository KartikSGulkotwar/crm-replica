import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;

describe('Metadata API (e2e)', () => {
  let t: TestApp;
  let admin: Agent;
  let schema: string;

  const tableColumns = async (table: string) =>
    (
      await t.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      )
    ).map((r: { column_name: string }) => r.column_name);

  const tableExists = async (table: string) =>
    (
      await t.dataSource.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      )
    ).length === 1;

  const objectByName = async (name: string) =>
    (await admin.get(`/api/metadata/objects/${name}`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
    const signup = await signupAgent(t, { workspaceName: 'Metadata Co' });
    admin = signup.agent;
    schema = `workspace_${signup.session.workspace.id.replace(/-/g, '')}`;
  });

  afterAll(() => t?.close());

  describe('standard objects', () => {
    it('are seeded on signup with real tables', async () => {
      const res = await admin.get('/api/metadata/objects').expect(200);
      const names = res.body.map((o: { nameSingular: string }) => o.nameSingular);
      expect(names).toEqual([
        'company',
        'person',
        'opportunity',
        'note',
        'task',
        'workspaceMember',
      ]);
      for (const table of [
        'companies',
        'people',
        'opportunities',
        'notes',
        'tasks',
        'workspace_members',
      ]) {
        expect(await tableExists(table)).toBe(true);
      }
      expect(await tableColumns('opportunities')).toEqual(
        expect.arrayContaining([
          'name',
          'amount_amount',
          'amount_currency',
          'stage',
          'close_date',
          'company_id',
          'point_of_contact_id',
        ]),
      );
    });

    it('describe relations in both directions', async () => {
      const company = await objectByName('company');
      expect(company.inverseRelations.map((r: { name: string }) => r.name).sort()).toEqual([
        'opportunities',
        'people',
      ]);
      const person = await objectByName('people'); // plural works too
      const companyField = person.fields.find((f: { name: string }) => f.name === 'company');
      expect(companyField.relation).toMatchObject({
        targetObjectName: 'company',
        inverseName: 'people',
        onDelete: 'SET_NULL',
      });
    });

    it('mirror workspace members (signup and invite)', async () => {
      const members = () =>
        t.dataSource.query(
          `SELECT name, email FROM "${schema}"."workspace_members" ORDER BY created_at`,
        );
      expect(await members()).toHaveLength(1);
      const link = await admin.get('/api/workspace/invite-link').expect(200);
      const joined = await t
        .http()
        .post(`/api/invites/${link.body.token}/accept`)
        .send({ name: 'Mo Member', email: uniqueEmail('mo'), password: 'password123' })
        .expect(201);
      expect((await members()).map((m: { name: string }) => m.name)).toEqual([
        'Ada Admin',
        'Mo Member',
      ]);
      await admin.delete(`/api/workspace/members/${joined.body.user.id}`).expect(204);
      expect(await members()).toHaveLength(1);
    });

    it('can’t be deleted, and their fields can’t be deleted', async () => {
      const company = await objectByName('company');
      const res = await admin.delete(`/api/metadata/objects/${company.id}`).expect(400);
      expect(res.body.message).toBe('Standard objects can’t be deleted');
      const domain = company.fields.find((f: { name: string }) => f.name === 'domain');
      await admin.delete(`/api/metadata/fields/${domain.id}`).expect(400);
    });

    it('can get custom fields', async () => {
      const company = await objectByName('company');
      const res = await admin
        .post(`/api/metadata/objects/${company.id}/fields`)
        .send({ label: 'Tier', type: 'RATING', settings: { max: 3 } })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'tier', isCustom: true, settings: { max: 3 } });
      expect(await tableColumns('companies')).toContain('tier');
    });
  });

  describe('custom objects', () => {
    let deal: { id: string; fields: { id: string; name: string }[] };

    it('creates a table with a default name field', async () => {
      const res = await admin
        .post('/api/metadata/objects')
        .send({
          nameSingular: 'deal',
          namePlural: 'deals',
          labelSingular: 'Deal',
          labelPlural: 'Deals',
          icon: 'handshake',
        })
        .expect(201);
      deal = res.body;
      expect(res.body).toMatchObject({
        isCustom: true,
        labelIdentifierFieldName: 'name',
        position: 5,
      });
      expect(res.body.fields.map((f: { name: string }) => f.name)).toEqual(['name']);
      expect(await tableColumns('deals')).toEqual(
        expect.arrayContaining([
          'id',
          'created_at',
          'updated_at',
          'deleted_at',
          'created_by',
          'position',
          'name',
        ]),
      );
    });

    it('adds fields of every type', async () => {
      const fields = [
        { label: 'Amount', type: 'CURRENCY' },
        { label: 'Probability', type: 'NUMBER' },
        { label: 'Is hot', type: 'BOOLEAN', defaultValue: false },
        { label: 'Close date', type: 'DATE' },
        { label: 'Signed at', type: 'DATE_TIME' },
        {
          label: 'Stage',
          type: 'SELECT',
          options: ['Lead', 'Negotiation', 'Won', 'Lost'],
          defaultValue: 'LEAD',
        },
        { label: 'Tags', type: 'MULTI_SELECT', options: ['Enterprise', 'SMB'] },
        { label: 'Contact email', type: 'EMAIL' },
        { label: 'Contact phone', type: 'PHONE' },
        { label: 'Website', type: 'LINK' },
        { label: 'Score', type: 'RATING' },
        {
          label: 'Company',
          type: 'RELATION',
          relation: { targetObject: 'company', inverseLabel: 'Deals' },
        },
      ];
      for (const field of fields) {
        await admin.post(`/api/metadata/objects/${deal.id}/fields`).send(field).expect(201);
      }
      expect(await tableColumns('deals')).toEqual(
        expect.arrayContaining([
          'amount_amount',
          'amount_currency',
          'probability',
          'is_hot',
          'close_date',
          'signed_at',
          'stage',
          'tags',
          'contact_email',
          'contact_phone',
          'website',
          'score',
          'company_id',
        ]),
      );
      // The reverse side appears on Company, named after the plural of the source object.
      const company = await objectByName('company');
      expect(company.inverseRelations).toContainEqual(
        expect.objectContaining({ name: 'deals', label: 'Deals', sourceObjectName: 'deal' }),
      );
    });

    it.each([
      [{ label: 'Stage', type: 'TEXT' }, 409, 'A field named "stage" already exists on Deal'],
      [
        { name: 'companyId', label: 'Company id', type: 'TEXT' },
        409,
        'clashes with an existing field',
      ],
      [{ label: 'Created at', type: 'TEXT' }, 400, 'built-in field name'],
      [{ name: 'evil"; DROP TABLE deals; --', label: 'X', type: 'TEXT' }, 400, 'Must be camelCase'],
      [
        { label: 'Owner', type: 'RELATION', relation: { targetObject: 'nope' } },
        400,
        'Unknown object "nope"',
      ],
      [
        {
          label: 'Rival',
          type: 'RELATION',
          relation: { targetObject: 'company', inverseName: 'people' },
        },
        409,
        '"people" is already used on Company',
      ],
    ])('rejects bad field %j', async (field, status, message) => {
      const res = await admin
        .post(`/api/metadata/objects/${deal.id}/fields`)
        .send(field)
        .expect(status);
      expect(String(res.body.message)).toContain(message);
      expect(await tableColumns('deals')).not.toContain('evil');
    });

    it.each([
      [
        { nameSingular: 'deal', namePlural: 'dealz', labelSingular: 'D', labelPlural: 'Ds' },
        409,
        'An object named "deal" already exists',
      ],
      [
        {
          nameSingular: 'company2',
          namePlural: 'companies',
          labelSingular: 'C',
          labelPlural: 'Cs',
        },
        409,
        'An object named "companies"',
      ],
      [
        { nameSingular: 'view', namePlural: 'viewz', labelSingular: 'V', labelPlural: 'Vs' },
        400,
        'This name is reserved',
      ],
      [
        { nameSingular: 'x; drop', namePlural: 'xs', labelSingular: 'X', labelPlural: 'Xs' },
        400,
        'Must be camelCase',
      ],
    ])('rejects bad object %j', async (object, status, message) => {
      const res = await admin.post('/api/metadata/objects').send(object).expect(status);
      expect(String(res.body.message)).toContain(message);
    });

    it('updates select options and clears removed values from records', async () => {
      const stage = (await objectByName('deal')).fields.find(
        (f: { name: string }) => f.name === 'stage',
      );
      const [row] = await t.dataSource.query(
        `INSERT INTO "${schema}"."deals" (stage) VALUES ('LOST') RETURNING id`,
      );
      const res = await admin
        .patch(`/api/metadata/fields/${stage.id}`)
        .send({
          label: 'Deal stage',
          options: ['Lead', 'Negotiation', { label: 'Closed won', value: 'WON', color: 'green' }],
        })
        .expect(200);
      expect(res.body.label).toBe('Deal stage');
      expect(res.body.options.map((o: { value: string }) => o.value)).toEqual([
        'LEAD',
        'NEGOTIATION',
        'WON',
      ]);
      const [after] = await t.dataSource.query(
        `SELECT stage FROM "${schema}"."deals" WHERE id = $1`,
        [row.id],
      );
      expect(after.stage).toBeNull();
    });

    it('rejects a default value that isn’t an option', async () => {
      const stage = (await objectByName('deal')).fields.find(
        (f: { name: string }) => f.name === 'stage',
      );
      const res = await admin
        .patch(`/api/metadata/fields/${stage.id}`)
        .send({ defaultValue: 'NOPE' })
        .expect(400);
      expect(res.body.message).toContain('defaultValue');
    });

    it('soft-deletes a field (column kept), restores it, then removes it permanently', async () => {
      const website = (await objectByName('deal')).fields.find(
        (f: { name: string }) => f.name === 'website',
      );
      await admin.delete(`/api/metadata/fields/${website.id}/permanent`).expect(400); // must soft-delete first
      await admin.delete(`/api/metadata/fields/${website.id}`).expect(200);
      expect(
        (await objectByName('deal')).fields.map((f: { name: string }) => f.name),
      ).not.toContain('website');
      expect(await tableColumns('deals')).toContain('website');

      await admin.post(`/api/metadata/fields/${website.id}/restore`).expect(201);
      expect((await objectByName('deal')).fields.map((f: { name: string }) => f.name)).toContain(
        'website',
      );

      await admin.delete(`/api/metadata/fields/${website.id}`).expect(200);
      await admin.delete(`/api/metadata/fields/${website.id}/permanent`).expect(204);
      expect(await tableColumns('deals')).not.toContain('website');
      // The name is free again once the column is gone.
      await admin
        .post(`/api/metadata/objects/${deal.id}/fields`)
        .send({ label: 'Website', type: 'LINK' })
        .expect(201);
    });

    it('won’t delete the field used as the record title', async () => {
      const name = (await objectByName('deal')).fields.find(
        (f: { name: string }) => f.name === 'name',
      );
      const res = await admin.delete(`/api/metadata/fields/${name.id}`).expect(400);
      expect(res.body.message).toContain('record title');
    });

    it('updates object labels', async () => {
      const res = await admin
        .patch(`/api/metadata/objects/${deal.id}`)
        .send({ labelPlural: 'Pipeline deals', icon: 'briefcase' })
        .expect(200);
      expect(res.body).toMatchObject({ labelPlural: 'Pipeline deals', icon: 'briefcase' });
    });

    it('soft-deletes an object with its incoming relations, restores, then destroys it', async () => {
      const ticket = (
        await admin
          .post('/api/metadata/objects')
          .send({
            nameSingular: 'ticket',
            namePlural: 'tickets',
            labelSingular: 'Ticket',
            labelPlural: 'Tickets',
            fields: [{ label: 'Subject', type: 'TEXT' }],
          })
          .expect(201)
      ).body;
      expect(ticket.labelIdentifierFieldName).toBe('subject');
      // A deal links to a ticket, so the deals table gets a foreign key to tickets.
      await admin
        .post(`/api/metadata/objects/${deal.id}/fields`)
        .send({ label: 'Ticket', type: 'RELATION', relation: { targetObject: 'ticket' } })
        .expect(201);

      await admin.delete(`/api/metadata/objects/${ticket.id}`).expect(200);
      const list = (await admin.get('/api/metadata/objects').expect(200)).body;
      expect(list.map((o: { nameSingular: string }) => o.nameSingular)).not.toContain('ticket');
      expect(
        (await objectByName('deal')).fields.map((f: { name: string }) => f.name),
      ).not.toContain('ticket');
      expect(await tableExists('tickets')).toBe(true); // data kept until permanent delete

      await admin.post(`/api/metadata/objects/${ticket.id}/restore`).expect(201);
      expect((await objectByName('deal')).fields.map((f: { name: string }) => f.name)).toContain(
        'ticket',
      );

      await admin.delete(`/api/metadata/objects/${ticket.id}`).expect(200);
      await admin.delete(`/api/metadata/objects/${ticket.id}/permanent`).expect(204);
      expect(await tableExists('tickets')).toBe(false);
      expect(await tableColumns('deals')).not.toContain('ticket_id');
      await admin.get(`/api/metadata/objects/${ticket.id}`).expect(404);
    });

    it('exports the whole data model', async () => {
      const res = await admin.get('/api/metadata/export').expect(200);
      expect(res.body.version).toBe(1);
      expect(res.body.objects.map((o: { nameSingular: string }) => o.nameSingular)).toContain(
        'deal',
      );
    });
  });

  describe('permissions and isolation', () => {
    it('lets members read but not change the data model', async () => {
      const link = await admin.get('/api/workspace/invite-link').expect(200);
      const member = request.agent(t.app.getHttpServer());
      await member
        .post(`/api/invites/${link.body.token}/accept`)
        .send({ name: 'Reader', email: uniqueEmail('reader'), password: 'password123' })
        .expect(201);
      await member.get('/api/metadata/objects').expect(200);
      await member
        .post('/api/metadata/objects')
        .send({
          nameSingular: 'sneaky',
          namePlural: 'sneakies',
          labelSingular: 'S',
          labelPlural: 'Ss',
        })
        .expect(403);
      const company = await objectByName('company');
      await member
        .post(`/api/metadata/objects/${company.id}/fields`)
        .send({ label: 'X', type: 'TEXT' })
        .expect(403);
    });

    it('keeps each workspace’s data model separate', async () => {
      const other = await signupAgent(t, { workspaceName: 'Other' });
      const otherNames = (await other.agent.get('/api/metadata/objects').expect(200)).body.map(
        (o: { nameSingular: string }) => o.nameSingular,
      );
      expect(otherNames).not.toContain('deal');
      const deal = await objectByName('deal');
      await other.agent.get(`/api/metadata/objects/${deal.id}`).expect(404);
      await other.agent
        .patch(`/api/metadata/objects/${deal.id}`)
        .send({ labelSingular: 'Hacked' })
        .expect(404);
      await other.agent.delete(`/api/metadata/fields/${deal.fields[0].id}`).expect(404);
      // Both workspaces can have an object with the same name, each with its own table.
      await other.agent
        .post('/api/metadata/objects')
        .send({
          nameSingular: 'deal',
          namePlural: 'deals',
          labelSingular: 'Deal',
          labelPlural: 'Deals',
        })
        .expect(201);
    });

    it('requires a session', async () => {
      await t.http().get('/api/metadata/objects').expect(401);
    });
  });
});
