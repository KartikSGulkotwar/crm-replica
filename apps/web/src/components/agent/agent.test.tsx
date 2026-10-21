import type { AgentConversationDto, AgentStreamEvent, ProposedAction } from '@crm-replica/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test-utils';
import { AgentPanel } from './AgentPanel';
import { Markdown } from './Markdown';

const at = '2026-10-20T10:00:00.000Z';
const conversation = (patch: Partial<AgentConversationDto> = {}): AgentConversationDto => ({
  id: 'c1',
  title: 'New conversation',
  transcript: [],
  awaitingApproval: false,
  createdAt: at,
  updatedAt: at,
  ...patch,
});
const sse = (events: AgentStreamEvent[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Route = (init: RequestInit | undefined) => Response;
function mockFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api/, '')}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return route(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const bodyOf = (fetchMock: ReturnType<typeof mockFetch>, key: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) =>
      `${init?.method ?? 'GET'} ${new URL(String(input), 'http://x').pathname}` ===
      `POST /api${key}`,
  );
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe('Markdown', () => {
  it('renders links, bold and lists without raw HTML, and drops unsafe links', () => {
    render(
      <MemoryRouter>
        <Markdown
          text={[
            'Found **2** deals:',
            '- [Acme expansion](/objects/opportunities/1)',
            '- [Docs](https://example.com/docs)',
            '[Click me](javascript:alert(1)) <img src=x onerror=alert(1)>',
          ].join('\n')}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('2').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Acme expansion' })).toHaveAttribute(
      'href',
      '/objects/opportunities/1',
    );
    const external = screen.getByRole('link', { name: 'Docs' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Click me' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});

describe('Ask the CRM panel', () => {
  // An in-memory localStorage (Node's own experimental one hides jsdom's in tests).
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const proposal: ProposedAction = {
    toolUseId: 'toolu_1',
    kind: 'update',
    object: 'opportunity',
    objectLabel: 'Opportunity',
    record: {
      object: 'opportunity',
      objectLabel: 'Opportunity',
      id: 'o1',
      title: 'Acme expansion',
      url: '/objects/opportunities/o1',
    },
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
  };

  it('streams an answer, then applies a proposed change only after Approve', async () => {
    const question = 'Mark the Acme deal as won';
    const afterQuestion = conversation({
      title: question,
      awaitingApproval: true,
      transcript: [
        { type: 'user', text: question, at },
        {
          type: 'assistant',
          text: 'I’ll update [Acme expansion](/objects/opportunities/o1).',
          records: [],
          at,
        },
        { type: 'proposal', id: 'p1', actions: [proposal], at },
      ],
    });
    const fetchMock = mockFetch({
      'GET /agent/status': () => json({ configured: true, model: 'claude-opus-5-5' }),
      'POST /agent/conversations': () => json(conversation(), 201),
      'GET /agent/conversations': () => json([]),
      'POST /agent/conversations/c1/messages': () =>
        sse([
          { type: 'activity', text: 'Searching opportunities…' },
          { type: 'text', text: 'I’ll update ' },
          { type: 'text', text: '[Acme expansion](/objects/opportunities/o1).' },
          { type: 'proposal', id: 'p1', actions: [proposal] },
          { type: 'done', conversation: afterQuestion },
        ]),
      'POST /agent/conversations/c1/decisions': () =>
        sse([
          {
            type: 'proposal',
            id: 'p1',
            actions: [{ ...proposal, status: 'approved', result: proposal.record }],
          },
          { type: 'text', text: 'Done.' },
          {
            type: 'done',
            conversation: {
              ...afterQuestion,
              awaitingApproval: false,
              transcript: [
                ...afterQuestion.transcript.slice(0, 2),
                {
                  type: 'proposal',
                  id: 'p1',
                  actions: [{ ...proposal, status: 'approved', result: proposal.record }],
                  at,
                },
                { type: 'assistant', text: 'Done.', records: [proposal.record!], at },
              ],
            },
          },
        ]),
    });
    const user = userEvent.setup();
    renderApp(<AgentPanel onClose={() => {}} />);

    expect(await screen.findByText('Ask anything about your CRM')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your question'), `${question}{Enter}`);

    const card = await screen.findByRole('region', { name: 'Proposed changes' });
    expect(within(card).getByText('Approve this change?')).toBeInTheDocument();
    expect(within(card).getByText('New')).toBeInTheDocument();
    expect(within(card).getByText('Won')).toBeInTheDocument();
    // Linked in the streamed answer and in the card.
    expect(screen.getAllByRole('link', { name: 'Acme expansion' })).toHaveLength(2);
    expect(bodyOf(fetchMock, '/agent/conversations/c1/messages')).toEqual({ text: question });
    // Waiting for a decision: new questions are blocked.
    expect(screen.getByLabelText('Your question')).toHaveAttribute(
      'placeholder',
      'Approve or reject the changes above first',
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(bodyOf(fetchMock, '/agent/conversations/c1/decisions')).toEqual({
      decisions: [{ toolUseId: 'toolu_1', approve: true }],
    });
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(screen.getByText('Records used')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('lets you leave out some of several changes', async () => {
    const second: ProposedAction = {
      ...proposal,
      toolUseId: 'toolu_2',
      record: { ...proposal.record!, id: 'o2', title: 'Beta deal' },
    };
    localStorage.setItem('crm.agent.conversation', 'c1');
    const fetchMock = mockFetch({
      'GET /agent/status': () => json({ configured: true, model: 'm' }),
      'GET /agent/conversations/c1': () =>
        json(
          conversation({
            awaitingApproval: true,
            transcript: [{ type: 'proposal', id: 'p1', actions: [proposal, second], at }],
          }),
        ),
      'POST /agent/conversations/c1/decisions': () =>
        sse([{ type: 'done', conversation: conversation() }]),
    });
    const user = userEvent.setup();
    renderApp(<AgentPanel onClose={() => {}} />);
    await user.click(await screen.findByRole('checkbox', { name: 'Include: update Beta deal' }));
    await user.click(screen.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, '/agent/conversations/c1/decisions')).toEqual({
        decisions: [
          { toolUseId: 'toolu_1', approve: true },
          { toolUseId: 'toolu_2', approve: false },
        ],
      }),
    );
  });

  it('explains how to set it up when there is no API key', async () => {
    mockFetch({ 'GET /agent/status': () => json({ configured: false, model: null }) });
    renderApp(<AgentPanel onClose={() => {}} />);
    expect(await screen.findByText('The assistant isn’t set up yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toBeDisabled();
  });

  it('shows errors such as the rate limit and keeps the question', async () => {
    mockFetch({
      'GET /agent/status': () => json({ configured: true, model: 'm' }),
      'POST /agent/conversations': () => json(conversation(), 201),
      'GET /agent/conversations': () => json([]),
      'POST /agent/conversations/c1/messages': () =>
        json({ message: 'You’re sending messages too quickly. Please wait a minute.' }, 429),
    });
    const user = userEvent.setup();
    renderApp(<AgentPanel onClose={() => {}} />);
    await user.type(await screen.findByLabelText('Your question'), 'hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('too quickly');
    expect(screen.getByLabelText('Your question')).toHaveValue('hello');
  });

  it('closes with Escape', async () => {
    mockFetch({ 'GET /agent/status': () => json({ configured: true, model: 'm' }) });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderApp(<AgentPanel onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
