import { createTestApp, signupAgent, TestApp } from './utils/test-app';

describe('API rate limiting (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    process.env.API_RATE_LIMIT = '5';
    t = await createTestApp();
  });
  afterAll(async () => {
    process.env.API_RATE_LIMIT = '100000';
    await t?.close();
  });

  it('limits requests per user per minute, with Retry-After', async () => {
    const { agent } = await signupAgent(t);
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 7; i++) {
      last = await agent.get('/api/objects/companies');
      statuses.push(last.status);
    }
    // signup counted as one request for this IP, not for the user: all 5 user requests pass.
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    expect(last!.headers['x-ratelimit-remaining']).toBe('0');
    expect(last!.body.message).toMatch(/Too many requests/);

    // Other users have their own allowance.
    const other = (await signupAgent(t)).agent;
    await other.get('/api/objects/companies').expect(200);
  });
});
