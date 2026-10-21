import type {
  AgentConversationDto,
  AgentRecordRef,
  AgentStreamEvent,
  TranscriptItem,
} from '@crm-replica/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, History, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  conversationKey,
  streamAgent,
  useAgentStatus,
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from '../../lib/agent';
import { Spinner } from '../ui';
import { Markdown } from './Markdown';
import { ProposalCard } from './ProposalCard';

const EXAMPLES = [
  'Which opportunities close this month, and how much are they worth?',
  'Summarise everything we know about our biggest company.',
  'Who are the people at companies in the software industry?',
  'Create a follow-up task for each new opportunity.',
];

const STORAGE_KEY = 'crm.agent.conversation';
const storage = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (id: string | null) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode etc.: just don't remember it.
    }
  },
};

/** What's shown while a turn streams in, before the saved conversation replaces it. */
type LiveItem = TranscriptItem | { type: 'thinking'; at: string };

function RecordChips({
  records,
  onNavigate,
}: {
  records: AgentRecordRef[];
  onNavigate: () => void;
}) {
  if (!records.length) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        Records used
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {records.map((r) => (
          <li key={r.id}>
            <Link
              to={r.url}
              onClick={onNavigate}
              title={`${r.objectLabel}: ${r.title}`}
              className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs hover:border-accent hover:text-accent"
            >
              <span className="text-muted">{r.objectLabel}</span>
              <span className="truncate font-medium">{r.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** On phones the panel covers the page, so following a link closes it. */
const closeOnPhone = (onClose: () => void) => () => {
  if (window.matchMedia('(max-width: 639px)').matches) onClose();
};

/**
 * “Ask the CRM”: a side panel available on every page. Answers stream in; any change the
 * assistant wants to make waits for Approve / Reject.
 */
export function AgentPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const status = useAgentStatus();
  const [conversationId, setConversationId] = useState<string | null>(storage.get);
  const conversation = useConversation(conversationId);
  const [showHistory, setShowHistory] = useState(false);
  const history = useConversations(showHistory);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<LiveItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const navigate = closeOnPhone(onClose);

  const select = (id: string | null) => {
    setConversationId(id);
    storage.set(id);
    setLive([]);
    setError(null);
    setShowHistory(false);
  };

  // A remembered conversation that no longer exists: start fresh.
  useEffect(() => {
    if (conversation.isError) select(null);
  }, [conversation.isError]);

  useEffect(() => input.current?.focus(), [conversationId, showHistory]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const transcript = conversation.data?.transcript ?? [];
  const items: LiveItem[] = [...transcript, ...live];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, live]);

  const now = () => new Date().toISOString();
  const withoutThinking = (prev: LiveItem[]) => prev.filter((p) => p.type !== 'thinking');

  const onEvent = (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'text':
        setLive((prev) => {
          const last = prev.at(-1);
          if (last?.type === 'assistant')
            return [...prev.slice(0, -1), { ...last, text: last.text + event.text }];
          return [
            ...withoutThinking(prev),
            { type: 'assistant', text: event.text, records: [], at: now() },
          ];
        });
        break;
      case 'activity':
        setLive((prev) => [
          ...withoutThinking(prev),
          { type: 'activity', text: event.text, at: now() },
          { type: 'thinking', at: now() },
        ]);
        break;
      case 'proposal': {
        // A decided proposal is already in the saved transcript: update it there.
        const saved = transcript.some((t) => t.type === 'proposal' && t.id === event.id);
        if (saved && conversationId) {
          queryClient.setQueryData<AgentConversationDto>(
            conversationKey(conversationId),
            (c) =>
              c && {
                ...c,
                transcript: c.transcript.map((t) =>
                  t.type === 'proposal' && t.id === event.id ? { ...t, actions: event.actions } : t,
                ),
              },
          );
        } else {
          setLive((prev) => [
            ...withoutThinking(prev),
            { type: 'proposal', id: event.id, actions: event.actions, at: now() },
          ]);
        }
        break;
      }
      case 'error':
        setLive((prev) => [
          ...withoutThinking(prev),
          { type: 'error', text: event.message, at: now() },
        ]);
        break;
      case 'done':
        queryClient.setQueryData(conversationKey(event.conversation.id), event.conversation);
        void queryClient.invalidateQueries({ queryKey: ['agent', 'conversations'] });
        setLive([]);
        break;
      case 'records':
        break;
    }
  };

  /** Streams one turn. Returns false if it couldn't start (e.g. rate limited). */
  async function run(path: (id: string) => string, body: unknown, optimistic: LiveItem[]) {
    setBusy(true);
    setError(null);
    setLive([...optimistic, { type: 'thinking', at: now() }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let id = conversationId;
      if (!id) {
        id = (await createConversation.mutateAsync()).id;
        setConversationId(id);
        storage.set(id);
      }
      await streamAgent(path(id), body, onEvent, controller.signal);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return true;
      setLive([]);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft('');
    const ok = await run((id) => `/agent/conversations/${id}/messages`, { text: question }, [
      { type: 'user', text: question, at: now() },
    ]);
    if (!ok) setDraft(question);
  }

  async function decide(decisions: { toolUseId: string; approve: boolean }[]) {
    await run((id) => `/agent/conversations/${id}/decisions`, { decisions }, []);
    // Approved changes may show on the page behind the panel.
    if (decisions.some((d) => d.approve))
      void queryClient.invalidateQueries({ queryKey: ['records'] });
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  };

  const awaiting = Boolean(conversation.data?.awaitingApproval) && !busy;
  const lastProposalId = [...items].reverse().find((i) => i.type === 'proposal')?.id;
  const notConfigured = Boolean(status.data && !status.data.configured);

  return (
    <aside
      aria-label="Ask the CRM"
      className="fixed inset-0 z-30 flex flex-col bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:border-l sm:border-line"
    >
      <header className="flex items-center gap-1 border-b border-line px-3 py-2.5">
        <Sparkles aria-hidden className="size-4 shrink-0 text-accent" />
        <h2 className="mr-auto truncate pl-1 text-sm font-semibold">
          {showHistory ? 'Conversations' : (conversation.data?.title ?? 'Ask the CRM')}
        </h2>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
          aria-label="Conversation history"
          title="Conversation history"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
        >
          <History aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => select(null)}
          disabled={busy}
          aria-label="New conversation"
          title="New conversation"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink disabled:opacity-50"
        >
          <Plus aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {history.isPending && <div className="p-3 text-sm text-muted">Loading…</div>}
          {history.data?.length === 0 && (
            <div className="p-3 text-sm text-muted">No conversations yet.</div>
          )}
          <ul>
            {history.data?.map((c) => (
              <li key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-raised">
                <button
                  type="button"
                  onClick={() => select(c.id)}
                  disabled={busy}
                  className={`min-w-0 flex-1 px-3 py-2 text-left text-sm ${c.id === conversationId ? 'font-medium text-accent' : ''}`}
                >
                  <span className="block truncate">{c.title}</span>
                  <span className="block text-xs text-muted">
                    {new Date(c.updatedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete “${c.title}”`}
                  disabled={busy && c.id === conversationId}
                  onClick={() =>
                    deleteConversation.mutate(c.id, {
                      onSuccess: () => {
                        if (c.id === conversationId) {
                          select(null);
                          setShowHistory(true);
                        }
                      },
                    })
                  }
                  className="mr-1 rounded-md p-1.5 text-muted opacity-60 hover:bg-surface hover:text-bad group-hover:opacity-100"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div
          ref={scroller}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm"
          aria-live="polite"
        >
          {notConfigured && (
            <div className="rounded-xl border border-line bg-raised p-4">
              <p className="font-medium">The assistant isn’t set up yet</p>
              <p className="mt-1 text-muted">
                An admin needs to add{' '}
                <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY</code> to the server’s{' '}
                <code className="rounded bg-surface px-1">.env</code> file and restart the server.
              </p>
            </div>
          )}
          {!notConfigured && items.length === 0 && !(conversationId && conversation.isPending) && (
            <div className="pt-6">
              <p className="text-base font-semibold">Ask anything about your CRM</p>
              <p className="mt-1 text-muted">
                It can look up records and suggest changes. Nothing changes until you approve it.
              </p>
              <ul className="mt-4 space-y-2">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => void ask(example)}
                      className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-accent hover:bg-accent-soft/40"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {conversationId && conversation.isPending && (
            <div className="grid place-items-center py-8 text-muted">
              <Spinner />
            </div>
          )}
          {items.map((item, index) => {
            switch (item.type) {
              case 'user':
                return (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3 py-2 text-white">
                      {item.text}
                    </div>
                  </div>
                );
              case 'assistant':
                return (
                  <div key={index}>
                    <Markdown text={item.text} onNavigate={navigate} />
                    <RecordChips records={item.records} onNavigate={navigate} />
                  </div>
                );
              case 'activity':
                return (
                  <div key={index} className="flex items-center gap-2 text-xs text-muted">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted/60" />
                    {item.text}
                  </div>
                );
              case 'thinking':
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 text-xs text-muted"
                    role="status"
                  >
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                    Thinking…
                  </div>
                );
              case 'proposal':
                return (
                  <ProposalCard
                    key={item.id}
                    actions={item.actions}
                    canDecide={awaiting && item.id === lastProposalId}
                    busy={busy}
                    onDecide={(d) => void decide(d)}
                    onNavigate={navigate}
                  />
                );
              case 'error':
                return (
                  <p key={index} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-bad">
                    {item.text}
                  </p>
                );
              default:
                return null;
            }
          })}
          {error && (
            <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-bad">
              {error}
            </p>
          )}
        </div>
      )}

      {!showHistory && (
        <form onSubmit={onSubmit} className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <label htmlFor="agent-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="agent-input"
              ref={input}
              rows={1}
              value={draft}
              maxLength={4000}
              disabled={notConfigured}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                awaiting ? 'Approve or reject the changes above first' : 'Ask about your data…'
              }
              className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none [field-sizing:content] placeholder:text-muted/70"
            />
            <button
              type="submit"
              disabled={busy || awaiting || !draft.trim() || notConfigured}
              aria-label="Send"
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-white disabled:opacity-40"
            >
              {busy ? <Spinner className="size-3.5" /> : <ArrowUp aria-hidden className="size-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            Answers can be wrong. Check important details in the linked records.
          </p>
        </form>
      )}
    </aside>
  );
}
