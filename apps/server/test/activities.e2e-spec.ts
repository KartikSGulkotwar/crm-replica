import { RecordActivitiesDto, TimelineEventDto, TimelinePage } from '@crm-replica/shared';
import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;
jest.setTimeout(30_000);

describe('Notes, tasks, timeline and search (e2e)', () => {
  let t: TestApp;
  let admin: Agent;
  let acme: { id: string; name: string };
  let deal: { id: string };
  let ada: { id: string };

  const create = async (plural: string, body: object, as: Agent = admin) =>
    (await as.post(`/api/objects/${plural}`).send(body).expect(201)).body;
  const timeline = async (path: string, query = ''): Promise<TimelinePage> =>
    (await admin.get(`/api/objects/${path}/timeline${query}`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
    admin = (await signupAgent(t, { name: 'Ada Admin', workspaceName: 'Activity Co' })).agent;
    acme = await create('companies', {
      name: 'Acme Robotics',
      domain: 'acme-robotics.example.com',
    });
    deal = await create('opportunities', { name: 'Acme fleet', stage: 'NEW', companyId: acme.id });
    ada = await create('people', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@analytical.example.com',
      companyId: acme.id,
    });
  });

  afterAll(() => t?.close());

  describe('notes and tasks linked to records', () => {
    it('creates a note already linked to records, and lists it on each of them', async () => {
      const note = await create('notes', {
        title: 'Discovery call',
        body: 'Budget approved',
        targets: [
          { object: 'company', id: acme.id },
          { object: 'opportunities', id: deal.id }, // plural names work too
          { object: 'company', id: acme.id }, // duplicates are ignored
        ],
      });
      expect(note).toMatchObject({ title: 'Discovery call' });
      expect(note.targets).toBeUndefined();

      const onAcme: RecordActivitiesDto = (
        await admin.get(`/api/objects/companies/${acme.id}/activities`).expect(200)
      ).body;
      expect(onAcme.tasks).toEqual([]);
      expect(onAcme.notes).toHaveLength(1);
      expect(onAcme.notes[0].record).toMatchObject({ id: note.id, title: 'Discovery call' });
      expect(onAcme.notes[0].targets).toEqual([
        {
          object: 'company',
          objectLabel: 'Company',
          id: acme.id,
          title: 'Acme Robotics',
          url: `/objects/companies/${acme.id}`,
        },
        expect.objectContaining({ object: 'opportunity', id: deal.id, title: 'Acme fleet' }),
      ]);
      const onDeal = (
        await admin.get(`/api/objects/opportunities/${deal.id}/activities`).expect(200)
      ).body as RecordActivitiesDto;
      expect(onDeal.notes.map((n) => n.record.id)).toEqual([note.id]);

      // Re-link: replace the targets with Ada only.
      const targets = (
        await admin
          .put(`/api/objects/notes/${note.id}/targets`)
          .send({ targets: [{ object: 'person', id: ada.id }] })
          .expect(200)
      ).body;
      expect(targets).toEqual([expect.objectContaining({ id: ada.id, title: 'Ada Lovelace' })]);
      expect(
        (await admin.get(`/api/objects/companies/${acme.id}/activities`).expect(200)).body.notes,
      ).toEqual([]);
      expect((await admin.get(`/api/objects/notes/${note.id}/targets`).expect(200)).body).toEqual(
        targets,
      );

      // A deleted note disappears from record pages.
      await admin.delete(`/api/objects/notes/${note.id}`).expect(200);
      expect(
        (await admin.get(`/api/objects/people/${ada.id}/activities`).expect(200)).body.notes,
      ).toEqual([]);
    });

    it('sorts open tasks first, by due date', async () => {
      const make = (title: string, extra: object) =>
        create('tasks', { title, targets: [{ object: 'opportunity', id: deal.id }], ...extra });
      await make('Done long ago', { status: 'DONE', dueDate: '2026-01-01T10:00:00Z' });
      await make('Later', { dueDate: '2026-12-01T10:00:00Z' });
      await make('Sooner', { dueDate: '2026-11-01T10:00:00Z' });
      await make('No date', {});
      const { tasks } = (
        await admin.get(`/api/objects/opportunities/${deal.id}/activities`).expect(200)
      ).body as RecordActivitiesDto;
      expect(tasks.map((x) => x.record.title)).toEqual([
        'Sooner',
        'Later',
        'No date',
        'Done long ago',
      ]);
    });

    it('rejects links to things that can’t be linked', async () => {
      const other = (await signupAgent(t, { workspaceName: 'Elsewhere' })).agent;
      const theirs = await create('companies', { name: 'Not yours' }, other);
      const note = await create('notes', { title: 'Plain' });
      const gone = await create('companies', { name: 'Gone' });
      await admin.delete(`/api/objects/companies/${gone.id}`).expect(200);
      const cases: [unknown, RegExp][] = [
        [[{ object: 'unicorn', id: acme.id }], /can’t be linked to "unicorn"/],
        [[{ object: 'workspaceMember', id: acme.id }], /can’t be linked/],
        [[{ object: 'note', id: note.id }], /can’t be linked to "note"/],
        [[{ object: 'company', id: gone.id }], /doesn’t exist/],
        [[{ object: 'company', id: theirs.id }], /doesn’t exist/],
        ['acme', /targets/],
      ];
      for (const [targets, message] of cases) {
        const res = await admin
          .post('/api/objects/notes')
          .send({ title: 'x', targets })
          .expect(400);
        expect([res.body.message].flat().join(' ')).toMatch(message);
      }
      // Nothing half-created.
      const notes = (await admin.get('/api/objects/notes?limit=200').expect(200)).body.data;
      expect(notes.filter((n: { title: string }) => n.title === 'x')).toEqual([]);
      // Only notes and tasks take targets.
      await admin.post('/api/objects/companies').send({ name: 'C', targets: [] }).expect(400);
      await admin
        .put(`/api/objects/companies/${acme.id}/targets`)
        .send({ targets: [] })
        .expect(400);
      await admin
        .put(`/api/objects/notes/${note.id}/targets`)
        .send({ targets: [{ object: 'company', id: 'nope' }] })
        .expect(400);
      // Other workspaces can't see or change them.
      await other.get(`/api/objects/notes/${note.id}/targets`).expect(404);
      await other.get(`/api/objects/companies/${acme.id}/activities`).expect(404);
    });
  });

  describe('timeline', () => {
    it('records creation, field changes (with readable values), deletion and restore', async () => {
      const c = await create('companies', { name: 'Timeline Inc', industry: 'RETAIL' });
      await admin
        .patch(`/api/objects/companies/${c.id}`)
        .send({ name: 'Timeline Ltd', industry: 'FINANCE' })
        .expect(200);
      await admin.patch(`/api/objects/companies/${c.id}`).send({ position: 99 }).expect(200); // ignored
      await admin
        .patch(`/api/objects/companies/${c.id}`)
        .send({ name: 'Timeline Ltd' })
        .expect(200); // no change
      await admin.delete(`/api/objects/companies/${c.id}`).expect(200);
      await admin.post(`/api/objects/companies/${c.id}/restore`).expect(200);

      const { data } = await timeline(`companies/${c.id}`);
      expect(data.map((e) => e.kind)).toEqual(['restored', 'deleted', 'updated', 'created']);
      const update = data[2];
      expect(update).toMatchObject({
        actor: { name: 'Ada Admin' },
        source: 'user',
        record: { object: 'company', title: 'Timeline Ltd', url: `/objects/companies/${c.id}` },
      });
      expect(update.changes).toEqual([
        { field: 'name', label: 'Name', before: 'Timeline Inc', after: 'Timeline Ltd' },
        {
          field: 'industry',
          label: 'Industry',
          before: 'RETAIL',
          after: 'FINANCE',
          beforeText: 'Retail',
          afterText: 'Finance',
        },
      ]);
    });

    it('shows relation changes by title, notes and tasks on linked records, and completed tasks', async () => {
      const p = await create('people', { firstName: 'Grace', lastName: 'Hopper' });
      await admin.patch(`/api/objects/people/${p.id}`).send({ companyId: acme.id }).expect(200);
      const task = await create('tasks', {
        title: 'Call Grace',
        targets: [{ object: 'person', id: p.id }],
      });
      await admin.patch(`/api/objects/tasks/${task.id}`).send({ status: 'DONE' }).expect(200);
      const note = await create('notes', { title: 'Met at conference' });
      await admin
        .put(`/api/objects/notes/${note.id}/targets`)
        .send({ targets: [{ object: 'person', id: p.id }] })
        .expect(200);

      const { data } = await timeline(`people/${p.id}`);
      expect(data.map((e) => e.kind)).toEqual([
        'note_added',
        'task_completed',
        'task_added',
        'updated',
        'created',
      ]);
      expect(data[0].activity).toMatchObject({
        object: 'note',
        id: note.id,
        title: 'Met at conference',
      });
      expect(data[1].activity).toMatchObject({ object: 'task', id: task.id, title: 'Call Grace' });
      expect(data[3].changes).toEqual([
        {
          field: 'companyId',
          label: 'Company',
          before: null,
          after: acme.id,
          afterText: 'Acme Robotics',
        },
      ]);
    });

    it('pages with a cursor, has a workspace feed, and stays private', async () => {
      const c = await create('companies', { name: 'Paged' });
      for (const n of [1, 2, 3, 4]) {
        await admin.patch(`/api/objects/companies/${c.id}`).send({ employees: n }).expect(200);
      }
      const first = await timeline(`companies/${c.id}`, '?limit=2');
      expect(first.data.map((e) => e.changes[0].after)).toEqual([4, 3]);
      const second = await timeline(`companies/${c.id}`, `?limit=2&before=${first.nextCursor}`);
      expect(second.data.map((e) => e.changes[0].after)).toEqual([2, 1]);
      const third = await timeline(`companies/${c.id}`, `?limit=2&before=${second.nextCursor}`);
      expect(third.data.map((e) => e.kind)).toEqual(['created']);
      expect(third.nextCursor).toBeNull();
      await admin.get(`/api/objects/companies/${c.id}/timeline?before=garbage`).expect(400);
      await admin.get(`/api/objects/companies/${c.id}/timeline?limit=0`).expect(400);

      const feed: TimelineEventDto[] = (await admin.get('/api/timeline?limit=3').expect(200)).body
        .data;
      expect(feed[0]).toMatchObject({ record: { id: c.id }, kind: 'updated' });
      // Only each record's own events: no duplicate "added to …" entries for notes and tasks.
      const all: TimelineEventDto[] = (await admin.get('/api/timeline?limit=100').expect(200)).body
        .data;
      expect(all.some((e) => ['note_added', 'task_added', 'task_completed'].includes(e.kind))).toBe(
        false,
      );
      expect(all.some((e) => e.record.object === 'note' && e.kind === 'created')).toBe(true);

      const other = (await signupAgent(t, { workspaceName: 'Private' })).agent;
      expect(
        (await other.get(`/api/objects/companies/${c.id}/timeline`).expect(200)).body.data,
      ).toEqual([]);
      expect((await other.get('/api/timeline').expect(200)).body.data).toEqual([]);
    });

    it('says when a change came through an API key', async () => {
      const key = (await admin.post('/api/api-keys').send({ name: 'Script' }).expect(201)).body.key;
      const c = (
        await t
          .http()
          .post('/api/objects/companies')
          .set({ Authorization: `Bearer ${key}` })
          .send({ name: 'From a script' })
          .expect(201)
      ).body;
      const { data } = await timeline(`companies/${c.id}`);
      expect(data[0]).toMatchObject({
        kind: 'created',
        source: 'api',
        actor: { name: 'Ada Admin' },
      });
    });
  });

  describe('search', () => {
    const search = async (q: string, as: Agent = admin) =>
      (await as.get(`/api/search?q=${encodeURIComponent(q)}`).expect(200)).body as {
        object: string;
        title: string;
        subtitle: string | null;
        url: string;
      }[];

    it('finds records of every object by title, full name, email or domain', async () => {
      expect((await search('acme')).map((r) => [r.object, r.title])).toEqual(
        expect.arrayContaining([
          ['company', 'Acme Robotics'],
          ['opportunity', 'Acme fleet'],
        ]),
      );
      const [person] = await search('ada love');
      expect(person).toMatchObject({
        object: 'person',
        title: 'Ada Lovelace',
        subtitle: 'ada@analytical.example.com',
        url: `/objects/people/${ada.id}`,
      });
      expect((await search('analytical.example')).map((r) => r.title)).toEqual(['Ada Lovelace']);
      expect((await search('acme-robotics.example')).map((r) => r.title)).toEqual([
        'Acme Robotics',
      ]);
    });

    it('treats wildcards literally, ignores empty queries and stays private', async () => {
      expect(await search('%')).toEqual([]);
      expect(await search('   ')).toEqual([]);
      await admin.get(`/api/search?q=${'x'.repeat(101)}`).expect(400);
      const other = (await signupAgent(t, { email: uniqueEmail() })).agent;
      expect(await search('acme', other)).toEqual([]);
    });
  });
});
