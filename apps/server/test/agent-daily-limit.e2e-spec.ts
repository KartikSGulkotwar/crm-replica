import { LlmClient } from '../src/llm/llm-client';
import { FakeLlm, message, text } from './utils/fake-llm';
import { createTestApp, signupAgent, TestApp } from './utils/test-app';

describe('AI assistant daily limit (e2e)', () => {
  let t: TestApp;
  const llm = new FakeLlm();

  beforeAll(async () => {
    process.env.AGENT_DAILY_LIMIT = '2';
    t = await createTestApp({ overrides: [[LlmClient, llm]] });
  });
  afterAll(async () => {
    delete process.env.AGENT_DAILY_LIMIT;
    await t?.close();
  });

  it('stops answering a user after the daily limit', async () => {
    const { agent } = await signupAgent(t);
    const c = (await agent.post('/api/agent/conversations').expect(201)).body;
    llm.script(message([text('one')]), message([text('two')]));
    for (const q of ['one', 'two'])
      await agent.post(`/api/agent/conversations/${c.id}/messages`).send({ text: q }).expect(200);
    const res = await agent
      .post(`/api/agent/conversations/${c.id}/messages`)
      .send({ text: 'three' })
      .expect(429);
    expect(res.body.message).toMatch(/today/);
    expect(llm.calls).toHaveLength(2);
  });
});
