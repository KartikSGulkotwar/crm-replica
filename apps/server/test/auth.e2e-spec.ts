import request from 'supertest';
import { createTestApp, signupAgent, TestApp, uniqueEmail } from './utils/test-app';

describe('Auth & workspaces (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t?.close());

  describe('signup', () => {
    it('creates a workspace, its Postgres schema and an admin, and sets an httpOnly cookie', async () => {
      const email = uniqueEmail('Signup');
      const res = await t
        .http()
        .post('/api/auth/signup')
        .send({
          name: '  Ada  ',
          email: `  ${email.toUpperCase()} `,
          password: 'password123',
          workspaceName: 'Acme',
        })
        .expect(201);

      expect(res.body).toEqual({
        user: { id: expect.any(String), email: email.toLowerCase(), name: 'Ada', role: 'admin' },
        workspace: { id: expect.any(String), name: 'Acme' },
      });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/crm_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);

      const schemaName = `workspace_${res.body.workspace.id.replace(/-/g, '')}`;
      const rows = await t.dataSource.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schemaName],
      );
      expect(rows).toHaveLength(1);
    });

    it('never stores the plain password', async () => {
      const { session } = await signupAgent(t, { password: 'super-secret-pw' });
      const [row] = await t.dataSource.query(
        `SELECT password_hash FROM core."user" WHERE id = $1`,
        [session.user.id],
      );
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
      expect(row.password_hash).not.toContain('super-secret-pw');
    });

    it('rejects a duplicate email with 409', async () => {
      const { body } = await signupAgent(t);
      const res = await t.http().post('/api/auth/signup').send(body).expect(409);
      expect(res.body.message).toBe('An account with this email already exists');
    });

    it.each([
      [{ email: 'not-an-email' }, 'Enter a valid email address'],
      [{ password: 'short' }, 'Password must be at least 8 characters'],
      [{ password: 'x'.repeat(73) }, 'Password is too long'],
      [{ workspaceName: '   ' }, 'Workspace name must be 1 to 100 characters'],
      [{ role: 'admin' }, 'property role should not exist'],
    ])('validates input %j', async (override, message) => {
      const body = {
        name: 'A',
        email: uniqueEmail(),
        password: 'password123',
        workspaceName: 'W',
        ...override,
      };
      const res = await t.http().post('/api/auth/signup').send(body).expect(400);
      expect(res.body.message).toContain(message);
    });
  });

  describe('login / me / logout', () => {
    it('logs in with the right password and returns the session', async () => {
      const { body } = await signupAgent(t);
      const agent = request.agent(t.app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({ email: body.email, password: body.password })
        .expect(200);
      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body.user).toMatchObject({ email: body.email, role: 'admin' });
      expect(me.body.workspace.name).toBe('Acme');
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      const { body } = await signupAgent(t);
      const wrong = await t
        .http()
        .post('/api/auth/login')
        .send({ email: body.email, password: 'nope-nope' })
        .expect(401);
      const unknown = await t
        .http()
        .post('/api/auth/login')
        .send({ email: uniqueEmail('ghost'), password: 'whatever1' })
        .expect(401);
      expect(wrong.body.message).toBe('Incorrect email or password');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('requires a session for protected routes', async () => {
      await t.http().get('/api/auth/me').expect(401);
      await t.http().get('/api/workspace/members').set('Cookie', 'crm_session=garbage').expect(401);
    });

    it('clears the cookie on logout', async () => {
      const { agent } = await signupAgent(t);
      await agent.get('/api/auth/me').expect(200);
      await agent.post('/api/auth/logout').expect(204);
      await agent.get('/api/auth/me').expect(401);
    });
  });

  describe('invites, roles and members', () => {
    async function workspaceWithMember() {
      const admin = await signupAgent(t, { workspaceName: 'Invite Co' });
      const link = await admin.agent.get('/api/workspace/invite-link').expect(200);
      expect(link.body.url).toMatch(/\/invite\/[A-Za-z0-9_-]{32}$/);

      const info = await t.http().get(`/api/invites/${link.body.token}`).expect(200);
      expect(info.body).toEqual({ workspaceName: 'Invite Co' });

      const member = request.agent(t.app.getHttpServer());
      const memberEmail = uniqueEmail('member');
      const joined = await member
        .post(`/api/invites/${link.body.token}/accept`)
        .send({ name: 'Mo Member', email: memberEmail, password: 'password123' })
        .expect(201);
      expect(joined.body.user.role).toBe('member');
      expect(joined.body.workspace.id).toBe(admin.session.workspace.id);
      return {
        admin,
        member,
        memberId: joined.body.user.id as string,
        token: link.body.token as string,
      };
    }

    it('lets someone join through the invite link as a member', async () => {
      const { admin } = await workspaceWithMember();
      const members = await admin.agent.get('/api/workspace/members').expect(200);
      expect(members.body.map((m: { role: string }) => m.role)).toEqual(['admin', 'member']);
    });

    it('stops the old link working after a reset', async () => {
      const { admin, token } = await workspaceWithMember();
      const reset = await admin.agent.post('/api/workspace/invite-link/reset').expect(201);
      expect(reset.body.token).not.toBe(token);
      await t.http().get(`/api/invites/${token}`).expect(404);
      await t
        .http()
        .post(`/api/invites/${token}/accept`)
        .send({ name: 'Late', email: uniqueEmail(), password: 'password123' })
        .expect(404);
    });

    it('blocks members from admin-only actions', async () => {
      const { member, memberId } = await workspaceWithMember();
      await member.get('/api/workspace/members').expect(200); // members can see who's in the workspace
      await member.get('/api/workspace/invite-link').expect(403);
      await member.post('/api/workspace/invite-link/reset').expect(403);
      await member.patch('/api/workspace').send({ name: 'Hijacked' }).expect(403);
      await member.patch(`/api/workspace/members/${memberId}`).send({ role: 'admin' }).expect(403);
    });

    it('applies role changes immediately', async () => {
      const { admin, member, memberId } = await workspaceWithMember();
      await admin.agent
        .patch(`/api/workspace/members/${memberId}`)
        .send({ role: 'admin' })
        .expect(200);
      await member.get('/api/workspace/invite-link').expect(200);
    });

    it('never leaves a workspace without an admin', async () => {
      const { admin } = await workspaceWithMember();
      const res = await admin.agent
        .patch(`/api/workspace/members/${admin.session.user.id}`)
        .send({ role: 'member' })
        .expect(400);
      expect(res.body.message).toBe('A workspace needs at least one admin');
      await admin.agent.delete(`/api/workspace/members/${admin.session.user.id}`).expect(400);
    });

    it('signs a removed member out', async () => {
      const { admin, member, memberId } = await workspaceWithMember();
      await admin.agent.delete(`/api/workspace/members/${memberId}`).expect(204);
      await member.get('/api/auth/me').expect(401);
    });

    it('keeps workspaces isolated from each other', async () => {
      const a = await workspaceWithMember();
      const other = await signupAgent(t, { workspaceName: 'Other' });
      // An admin of another workspace can't touch this workspace's members.
      await other.agent
        .patch(`/api/workspace/members/${a.memberId}`)
        .send({ role: 'admin' })
        .expect(404);
      await other.agent.delete(`/api/workspace/members/${a.memberId}`).expect(404);
      const list = await other.agent.get('/api/workspace/members').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('lets admins rename the workspace', async () => {
      const { agent } = await signupAgent(t);
      await agent.patch('/api/workspace').send({ name: 'Renamed Ltd' }).expect(200);
      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body.workspace.name).toBe('Renamed Ltd');
    });
  });
});
