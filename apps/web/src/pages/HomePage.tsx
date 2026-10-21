import type { ComponentStatus, HealthResponse, ListRecordsResponse } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TimelineList } from '../components/activity/Timeline';
import { DemoDataCard } from '../components/DemoDataCard';
import { Button, Card, FormError, Spinner } from '../components/ui';
import { useActivityFeed, useUpdateActivity } from '../lib/activities';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import { useObjects } from '../lib/metadata';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

const COMPONENTS: { key: keyof HealthResponse['checks']; label: string }[] = [
  { key: 'database', label: 'Database' },
  { key: 'redis', label: 'Redis' },
  { key: 'worker', label: 'Worker' },
];

function StatusDot({ status }: { status: ComponentStatus | 'unknown' }) {
  const color = status === 'up' ? 'bg-ok' : status === 'down' ? 'bg-bad' : 'bg-muted';
  return <span aria-hidden className={`inline-block size-2 rounded-full ${color}`} />;
}

/** One line at the bottom of the page: is everything running? */
function SystemStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health'),
    refetchInterval: 15_000,
    retry: false,
  });
  const rows: [string, ComponentStatus | 'unknown'][] = [
    ['API', health.isPending ? 'unknown' : health.isError ? 'down' : 'up'],
    ...COMPONENTS.map(
      (c) =>
        [
          c.label,
          health.data ? health.data.checks[c.key] : health.isError ? 'down' : 'unknown',
        ] as [string, ComponentStatus | 'unknown'],
    ),
  ];
  return (
    <section
      aria-label="System status"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
    >
      {rows.map(([label, status]) => (
        <span key={label} className="flex items-center gap-1.5" data-testid={`status-${label}`}>
          <StatusDot status={status} />
          {label} {status === 'up' ? 'up' : status === 'down' ? 'down' : '…'}
        </span>
      ))}
      <a className="text-accent underline-offset-2 hover:underline" href="/api/docs">
        API docs
      </a>
      {health.isError && (
        <span role="alert" className="text-bad">
          Can’t reach the API. Is <code className="font-mono">pnpm dev</code> running?
        </span>
      )}
    </section>
  );
}

function MyTasks({ me }: { me: string }) {
  const update = useUpdateActivity();
  const toast = useToast();
  const filter = {
    and: [
      { field: 'assignee', op: 'eq', value: me },
      { field: 'status', op: 'neq', value: 'DONE' },
    ],
  };
  const tasks = useQuery({
    queryKey: ['records', 'tasks', 'mine', me],
    queryFn: () =>
      api<ListRecordsResponse>(
        `/objects/tasks?limit=8&sort=dueDate:asc&filter=${encodeURIComponent(JSON.stringify(filter))}`,
      ),
  });
  return (
    <Card
      title="My tasks"
      actions={
        <Link to="/objects/tasks" className="text-sm text-accent hover:underline">
          All tasks
        </Link>
      }
    >
      {tasks.isPending && (
        <div className="p-4">
          <Spinner />
        </div>
      )}
      {tasks.isError && (
        <div className="p-4">
          <FormError error={tasks.error} />
        </div>
      )}
      {tasks.data?.data.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted">Nothing assigned to you. Nice.</p>
      )}
      <ul className="divide-y divide-line">
        {tasks.data?.data.map((t) => {
          const due = t.dueDate as string | null;
          const overdue = due && new Date(due) < new Date();
          const title = (t.title as string) || 'Untitled task';
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2">
              <input
                type="checkbox"
                aria-label={`Done: ${title}`}
                className="size-4 accent-[var(--color-accent)]"
                onChange={() =>
                  update.mutate(
                    { kind: 'tasks', id: t.id, values: { status: 'DONE' } },
                    { onError: (e) => toast(`Couldn’t update: ${(e as Error).message}`, 'error') },
                  )
                }
              />
              <Link
                to={`/objects/tasks/${t.id}`}
                className="min-w-0 flex-1 truncate text-sm hover:text-accent"
              >
                {title}
              </Link>
              {due && (
                <span className={`shrink-0 text-xs ${overdue ? 'text-bad' : 'text-muted'}`}>
                  Due {formatRelative(due)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RecentActivity() {
  const feed = useActivityFeed();
  const objects = useObjects().data ?? [];
  const events = feed.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card title="Recent activity">
      <div className="p-4">
        {feed.isPending && <Spinner />}
        {feed.isError && <FormError error={feed.error} />}
        {feed.data && events.length === 0 && (
          <p className="text-sm text-muted">
            Nothing yet. Changes to records, notes and tasks show up here.
          </p>
        )}
        <TimelineList events={events} objects={objects} showRecord />
        {feed.hasNextPage && (
          <Button
            variant="ghost"
            className="mt-3"
            loading={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            Show older
          </Button>
        )}
      </div>
    </Card>
  );
}

export function HomePage() {
  const session = useSession().data;
  const first = session?.user.name.split(' ')[0];
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{first ? `, ${first}` : ''}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <Search aria-hidden className="size-3.5" /> {mod}K to find anything
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles aria-hidden className="size-3.5" /> {mod}J to ask the CRM
          </span>
        </p>
      </header>
      <DemoDataCard hideWhenLoaded />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <RecentActivity />
        <div className="order-first space-y-6 lg:order-none">
          {session && <MyTasks me={session.user.id} />}
        </div>
      </div>
      <SystemStatus />
    </div>
  );
}
