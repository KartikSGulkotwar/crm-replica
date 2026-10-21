import type Anthropic from '@anthropic-ai/sdk';
import { AgentConversationDto, AgentStreamEvent } from '@crm-replica/shared';
import request from 'supertest';
import { LlmClient } from '../src/llm/llm-client';
import { FakeLlm, message, text, toolUse } from './utils/fake-llm';
import { createTestApp, signupAgent, TestApp } from './utils/test-app';

type Agent = ReturnType<typeof request.agent>;
type Param = Anthropic.Beta.BetaMessageParam;
jest.setTimeout(30_000);

/** Reads a whole Server-Sent Events response into its events. */
function sse(req: request.Test) {
  return req.buffer(true).parse((res, done) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => (body += chunk));
    res.on('end', () => done(null, body));
  });
}
const eventsOf = (body: string): AgentStreamEvent[] =>
  body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as AgentStreamEvent);
const doneOf = (events: AgentStreamEvent[]) => {
  const done = events.at(-1);
  if (done?.type !== 'done')
    throw new Error(`Stream didn't end with done: ${JSON.stringify(events)}`);
  return done.conversation;
};
/** Tool results the model was sent in the user message at `index` of a request. */
const toolResults = (messages: Param[], index = messages.length - 1) =>
  (messages[index].content as Anthropic.Beta.BetaToolResultBlockParam[]).filter(
    (b) => b.type === 'tool_result',
  );

describe('AI assistant (e2e, with a scripted model)', () => {
  let t: TestApp;
  let admin: Agent;
  const llm = new FakeLlm();
  let acme: { id: string };
  let deal: { id: string };

  const newConversation = async (as: Agent = admin): Promise<AgentConversationDto> =>
    (await as.post('/api/agent/conversations').expect(201)).body;
  const ask = async (id: string, question: string, as: Agent = admin) => {
    const res = await sse(
      as.post(`/api/agent/conversations/${id}/messages`).send({ text: question }),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    return eventsOf(res.body as string);
  };
  const decide = async (id: string, decisions: { toolUseId: string; approve: boolean }[]) => {
    const res = await sse(
      admin.post(`/api/agent/conversations/${id}/decisions`).send({ decisions }),
    );
    expect(res.status).toBe(200);
    return eventsOf(res.body as string);
  };

  beforeAll(async () => {
    t = await createTestApp({ overrides: [[LlmClient, llm]] });
    admin = (await signupAgent(t, { name: 'Ada Admin', workspaceName: 'Agent Co' })).agent;
    acme = (await admin.post('/api/objects/companies').send({ name: 'Acme Robotics' }).expect(201))
      .body;
    deal = (
      await admin
        .post('/api/objects/opportunities')
        .send({ name: 'Acme expansion', stage: 'NEW', companyId: acme.id })
        .expect(201)
    ).body;
  });

  afterAll(() => t?.close());
  beforeEach(() => llm.reset());

  it('reports whether it is set up', async () => {
    await admin.get('/api/agent/status').expect(200, { configured: true, model: 'fake-model' });
    llm.configured = false;
    await admin.get('/api/agent/status').expect(200, { configured: false, model: null });
  });

  it('answers 503 (before streaming) when no API key is configured', async () => {
    llm.configured = false;
    const c = await newConversation();
    const res = await admin
      .post(`/api/agent/conversations/${c.id}/messages`)
      .send({ text: 'hi' })
      .expect(503);
    expect(res.body.message).toMatch(/ANTHROPIC_API_KEY/);
    expect(llm.calls).toHaveLength(0);
  });

  it('searches with tools, streams the answer and links the records it used', async () => {
    llm.script(
      message([
        text('Let me look. '),
        toolUse('search_records', {
          object: 'company',
          filter: { field: 'name', op: 'contains', value: 'acme' },
        }),
      ]),
      message([text(`You have one: [Acme Robotics](/objects/companies/${acme.id}).`)]),
    );
    const c = await newConversation();
    const events = await ask(c.id, 'Which companies match acme?');

    // The request: generated tools, the system prompt, adaptive thinking.
    const first = llm.calls[0];
    expect(first.tools?.map((tool) => (tool as Anthropic.Beta.BetaTool).name)).toEqual([
      'list_objects',
      'describe_object',
      'search_records',
      'get_record',
      'create_record',
      'update_record',
    ]);
    const search = first.tools![2] as Anthropic.Beta.BetaTool;
    expect(search.eager_input_streaming).toBe(true);
    expect((search.input_schema.properties as { object: { enum: string[] } }).object.enum).toEqual(
      expect.arrayContaining(['company', 'person', 'opportunity']),
    );
    expect(first.system).toMatch(/Agent Co/);
    expect(first.thinking).toEqual({ type: 'adaptive' });
    expect(first.messages).toEqual([{ role: 'user', content: 'Which companies match acme?' }]);

    // The tool ran in this workspace and its result went back to the model.
    const [result] = toolResults(llm.calls[1].messages);
    expect(result.is_error).toBeUndefined();
    expect(String(result.content)).toContain('Acme Robotics');
    expect(String(result.content)).toContain(`/objects/companies/${acme.id}`);

    expect(events.map((e) => e.type)).toEqual(['text', 'activity', 'records', 'text', 'done']);
    const conversation = doneOf(events);
    expect(conversation.title).toBe('Which companies match acme?');
    expect(conversation.awaitingApproval).toBe(false);
    const answer = conversation.transcript.at(-1);
    expect(answer).toMatchObject({
      type: 'assistant',
      text: expect.stringContaining('Acme Robotics'),
      records: [
        {
          object: 'company',
          id: acme.id,
          title: 'Acme Robotics',
          url: `/objects/companies/${acme.id}`,
        },
      ],
    });

    // A follow-up sends the history exactly as before (append-only), plus the new question.
    llm.script(message([text('Nothing else.')]));
    await ask(c.id, 'Anything else?');
    const earlier = llm.calls[1].messages;
    const later = llm.calls[2].messages;
    expect(later.slice(0, earlier.length)).toEqual(earlier);
    expect(later.slice(earlier.length)).toEqual([
      { role: 'assistant', content: [expect.objectContaining({ type: 'text' })] },
      { role: 'user', content: 'Anything else?' },
    ]);

    // Conversations are listed and can be reopened.
    const list = (await admin.get('/api/agent/conversations').expect(200)).body;
    expect(list[0]).toMatchObject({ id: c.id, title: 'Which companies match acme?' });
    const reopened = (await admin.get(`/api/agent/conversations/${c.id}`).expect(200)).body;
    expect(reopened.transcript.map((i: { type: string }) => i.type)).toEqual([
      'user',
      'assistant',
      'activity',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('proposes an update, changes nothing until approved, then applies it', async () => {
    const update = toolUse('update_record', {
      object: 'opportunity',
      id: deal.id,
      data: { stage: 'WON' },
    });
    llm.script(message([text('I’ll mark it won.'), update]));
    const c = await newConversation();
    const events = await ask(c.id, 'Mark the Acme deal as won');

    const proposal = events.find((e) => e.type === 'proposal');
    expect(proposal).toMatchObject({
      actions: [
        {
          toolUseId: update.type === 'tool_use' ? update.id : '',
          kind: 'update',
          object: 'opportunity',
          record: { id: deal.id, title: 'Acme expansion' },
          changes: [
            {
              field: 'stage',
              label: 'Stage',
              before: 'NEW',
              after: 'WON',
              beforeText: 'New',
              afterText: 'Won',
            },
          ],
          status: 'pending',
        },
      ],
    });
    expect(doneOf(events).awaitingApproval).toBe(true);
    // Nothing changed yet, and new questions wait for the decision.
    expect((await admin.get(`/api/objects/opportunities/${deal.id}`).expect(200)).body.stage).toBe(
      'NEW',
    );
    await admin
      .post(`/api/agent/conversations/${c.id}/messages`)
      .send({ text: 'hello?' })
      .expect(409);

    llm.script(message([text('Done — it’s marked Won.')]));
    const after = await decide(c.id, [{ toolUseId: (update as { id: string }).id, approve: true }]);
    expect((await admin.get(`/api/objects/opportunities/${deal.id}`).expect(200)).body.stage).toBe(
      'WON',
    );
    const [result] = toolResults(llm.calls[1].messages);
    expect(result).toMatchObject({ tool_use_id: (update as { id: string }).id });
    expect(result.is_error).toBeUndefined();
    expect(after.find((e) => e.type === 'proposal')).toMatchObject({
      actions: [{ status: 'approved', result: { id: deal.id } }],
    });
    const conversation = doneOf(after);
    expect(conversation.awaitingApproval).toBe(false);
    expect(conversation.transcript.at(-1)).toMatchObject({
      type: 'assistant',
      records: [expect.objectContaining({ id: deal.id })],
    });
    // Deciding twice isn't possible.
    await admin
      .post(`/api/agent/conversations/${c.id}/decisions`)
      .send({ decisions: [{ toolUseId: 'x', approve: true }] })
      .expect(400);
  });

  it('a rejected proposal creates nothing and tells the model', async () => {
    const create = toolUse('create_record', {
      object: 'opportunity',
      data: { name: 'Should Not Exist', companyId: acme.id },
    });
    const read = toolUse('list_objects', {});
    llm.script(message([read, create]), message([text('Okay, I didn’t create it.')]));
    const c = await newConversation();
    const events = await ask(c.id, 'Create a deal called Should Not Exist for Acme');
    expect(events.find((e) => e.type === 'proposal')).toMatchObject({
      actions: [
        {
          kind: 'create',
          changes: [
            { field: 'name', after: 'Should Not Exist' },
            { field: 'companyId', label: 'Company', after: acme.id, afterText: 'Acme Robotics' },
          ],
        },
      ],
    });

    await decide(c.id, [{ toolUseId: (create as { id: string }).id, approve: false }]);
    const deals = (await admin.get('/api/objects/opportunities').expect(200)).body.data;
    expect(deals.map((r: { name: string }) => r.name)).not.toContain('Should Not Exist');
    // Both calls of the paused turn got a result, in order.
    const results = toolResults(llm.calls[1].messages);
    expect(results.map((r) => r.tool_use_id)).toEqual([
      (read as { id: string }).id,
      (create as { id: string }).id,
    ]);
    expect(results[1].content).toMatch(/rejected/);
  });

  it('a proposal that would fail goes back to the model as an error instead of to the user', async () => {
    llm.script(
      message([
        toolUse('update_record', { object: 'opportunity', id: deal.id, data: { stage: 'MAYBE' } }),
      ]),
      message([text('That stage doesn’t exist.')]),
    );
    const c = await newConversation();
    const events = await ask(c.id, 'Set the stage to maybe');
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
    const [result] = toolResults(llm.calls[1].messages);
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toMatch(/Not proposed/);
    expect(doneOf(events).awaitingApproval).toBe(false);
  });

  it('rejects tool input that does not match the schema', async () => {
    llm.script(
      message([toolUse('search_records', { object: 'company', limit: 'lots' })]),
      message([text('Sorry.')]),
    );
    const c = await newConversation();
    await ask(c.id, 'Show companies');
    const [result] = toolResults(llm.calls[1].messages);
    expect(result.is_error).toBe(true);
  });

  it('a refusal ends the turn with a message and isn’t added to the history', async () => {
    llm.script(message([], 'refusal'));
    const c = await newConversation();
    const events = await ask(c.id, 'Something it declines');
    expect(events).toContainEqual({ type: 'error', message: 'I can’t help with that request.' });
    llm.script(message([text('Hi!')]));
    await ask(c.id, 'hello');
    expect(llm.calls[1].messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('a tool call cut off at max_tokens is not run, but still gets a result', async () => {
    llm.script(
      message(
        [toolUse('create_record', { object: 'company', data: { name: 'Half' } })],
        'max_tokens',
      ),
    );
    const c = await newConversation();
    const events = await ask(c.id, 'Make a company');
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    llm.script(message([text('ok')]));
    await ask(c.id, 'try again');
    const results = toolResults(llm.calls[1].messages, 2);
    expect(results[0].is_error).toBe(true);
  });

  it('after a mid-answer fallback, only what the fallback model said is kept (and run)', async () => {
    const dropped = toolUse('create_record', { object: 'company', data: { name: 'Dropped' } });
    llm.script(
      message([
        { type: 'thinking', thinking: '', signature: 'sig' } as never,
        dropped,
        {
          type: 'fallback',
          from: { model: 'fake-model' },
          to: { model: 'fake-fallback' },
          reason: 'refusal',
        } as never,
        text('Here is what I can say.'),
      ]),
    );
    const c = await newConversation();
    const events = await ask(c.id, 'hello');
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
    llm.script(message([text('ok')]));
    await ask(c.id, 'next');
    expect(llm.calls[1].messages[1]).toEqual({
      role: 'assistant',
      content: [
        expect.objectContaining({ type: 'fallback' }),
        expect.objectContaining({ type: 'text', text: 'Here is what I can say.' }),
      ],
    });
  });

  it('answers one question at a time per conversation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    llm.script(async () => {
      await gate;
      return message([text('Slow answer.')]);
    });
    const c = await newConversation();
    const slow = ask(c.id, 'slow one');
    // Wait until the first request reached the model, then try a second one.
    try {
      while (llm.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
      await admin
        .post(`/api/agent/conversations/${c.id}/messages`)
        .send({ text: 'impatient' })
        .expect(409);
    } finally {
      release(); // even on failure, or the open request keeps the app from closing
    }
    expect(doneOf(await slow).transcript.at(-1)).toMatchObject({ text: 'Slow answer.' });
    // Free again afterwards.
    llm.script(message([text('Fast.')]));
    await ask(c.id, 'next');
  });

  it('a failing model request shows a friendly error and frees the conversation', async () => {
    // Nothing scripted: the fake throws.
    const c = await newConversation();
    const events = await ask(c.id, 'hello');
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      message: expect.stringMatching(/couldn’t answer/),
    });
    llm.script(message([text('Back now.')]));
    expect(doneOf(await ask(c.id, 'hello again')).transcript.at(-1)).toMatchObject({
      text: 'Back now.',
    });
  });

  it('keeps conversations and data private to their user and workspace', async () => {
    const mine = await newConversation();
    const other = (await signupAgent(t, { workspaceName: 'Other Co' })).agent;
    await other.get(`/api/agent/conversations/${mine.id}`).expect(404);
    await other.delete(`/api/agent/conversations/${mine.id}`).expect(404);
    await other
      .post(`/api/agent/conversations/${mine.id}/messages`)
      .send({ text: 'hi' })
      .expect(404);
    expect((await other.get('/api/agent/conversations').expect(200)).body).toEqual([]);

    // The other workspace's assistant can't read this workspace's records.
    llm.script(
      message([toolUse('get_record', { object: 'company', id: acme.id })]),
      message([text('Not found.')]),
    );
    const theirs = await newConversation(other);
    await ask(theirs.id, 'Show me Acme', other);
    const [result] = toolResults(llm.calls[1].messages);
    expect(result.is_error).toBe(true);
    expect(String(result.content)).not.toContain('Acme Robotics');

    // A teammate in the same workspace can't open someone else's conversation either.
    const link = await admin.get('/api/workspace/invite-link').expect(200);
    const teammate = request.agent(t.app.getHttpServer());
    await teammate
      .post(`/api/invites/${link.body.token}/accept`)
      .send({
        name: 'Tess Teammate',
        email: `tess-${Date.now()}@example.com`,
        password: 'password123',
      })
      .expect(201);
    await teammate.get(`/api/agent/conversations/${mine.id}`).expect(404);
  });

  it('validates questions and deletes conversations', async () => {
    const c = await newConversation();
    await admin.post(`/api/agent/conversations/${c.id}/messages`).send({ text: '  ' }).expect(400);
    await admin.get('/api/agent/conversations/not-a-uuid').expect(404);
    await admin.delete(`/api/agent/conversations/${c.id}`).expect(204);
    await admin.get(`/api/agent/conversations/${c.id}`).expect(404);
    await t.http().get('/api/agent/conversations').expect(401);
  });
});
