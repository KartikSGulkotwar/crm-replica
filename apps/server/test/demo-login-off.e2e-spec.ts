import { createTestApp, TestApp } from './utils/test-app';

describe('Without DEMO_MODE (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('has no demo login', async () => {
    expect((await t.http().get('/api/auth/demo').expect(200)).body).toEqual({ enabled: false });
  });
});
