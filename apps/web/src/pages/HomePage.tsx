import type { ComponentStatus, HealthResponse } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const COMPONENTS: { key: keyof HealthResponse['checks']; label: string; hint: string }[] = [
  { key: 'database', label: 'Database', hint: 'PostgreSQL: stores metadata and records' },
  { key: 'redis', label: 'Redis', hint: 'Queue broker for background jobs' },
  { key: 'worker', label: 'Worker', hint: 'Runs workflows in the background' },
];

function StatusDot({ status }: { status: ComponentStatus | 'unknown' }) {
  const color = status === 'up' ? 'bg-ok' : status === 'down' ? 'bg-bad' : 'bg-muted';
  return <span aria-hidden className={`inline-block size-2.5 rounded-full ${color}`} />;
}

function StatusRow({
  label,
  hint,
  status,
}: {
  label: string;
  hint: string;
  status: ComponentStatus | 'unknown';
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted">{hint}</div>
      </div>
      <span className="flex shrink-0 items-center gap-2 text-sm" data-testid={`status-${label}`}>
        <StatusDot status={status} />
        {status === 'up' ? 'Up' : status === 'down' ? 'Down' : '…'}
      </span>
    </li>
  );
}

export function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health'),
    refetchInterval: 5000,
    retry: false,
  });

  const apiStatus: ComponentStatus | 'unknown' = health.isPending
    ? 'unknown'
    : health.isError
      ? 'down'
      : 'up';

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
      <p className="mt-1 text-sm text-muted">
        A customizable CRM: objects, views, workflows and an AI agent. The pieces arrive phase by
        phase; this page confirms the foundation is running.
      </p>

      <section className="mt-8 rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">System status</h2>
          {health.data && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                health.data.status === 'ok' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'
              }`}
            >
              {health.data.status === 'ok' ? 'All systems go' : 'Degraded'}
            </span>
          )}
        </div>
        <ul className="divide-y divide-line">
          <StatusRow label="API" hint="NestJS server" status={apiStatus} />
          {COMPONENTS.map((c) => (
            <StatusRow
              key={c.key}
              label={c.label}
              hint={c.hint}
              status={health.data ? health.data.checks[c.key] : health.isError ? 'down' : 'unknown'}
            />
          ))}
        </ul>
        {health.isError && (
          <p role="alert" className="border-t border-line px-4 py-3 text-sm text-bad">
            Can’t reach the API. Is <code className="font-mono">pnpm dev</code> running?
          </p>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Refreshes every 5 seconds · API docs at{' '}
          <a className="text-accent underline-offset-2 hover:underline" href="/api/docs">
            /api/docs
          </a>
        </p>
      </section>
    </div>
  );
}
