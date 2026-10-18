import { createTestApp, TestApp, uniqueEmail } from './utils/test-app';

describe('Auth rate limiting (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT = '3';
    t = await createTestApp();
  });

  afterAll(() => t?.close());

  it('returns 429 after too many login attempts in a minute', async () => {
    const attempt = () =>
      t.http().post('/api/auth/login').send({ email: uniqueEmail(), password: 'wrong-pass' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it('does not rate-limit ordinary endpoints', async () => {
    // A public, unthrottled endpoint: an unknown invite link is a plain 404, never a 429.
    for (let i = 0; i < 5; i++) await t.http().get('/api/invites/unknown').expect(404);
  });
});
