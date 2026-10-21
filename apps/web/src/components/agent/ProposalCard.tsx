import type { CurrencyValue, ProposedAction, ProposedChange } from '@crm-replica/shared';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import { Button } from '../ui';

const STATUS: Record<ProposedAction['status'], { label: string; className: string } | null> = {
  pending: null,
  approved: { label: 'Applied', className: 'bg-ok/15 text-ok' },
  rejected: { label: 'Rejected', className: 'bg-raised text-muted' },
  failed: { label: 'Failed', className: 'bg-bad/10 text-bad' },
};

function show(value: unknown, text?: string): string {
  if (text) return text;
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((v) => show(v)).join(', ') || 'empty';
  if (typeof value === 'object' && 'amount' in value)
    return formatCurrency(value as CurrencyValue) || 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ChangeRow({ change, kind }: { change: ProposedChange; kind: ProposedAction['kind'] }) {
  return (
    <li className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2 py-1 text-sm">
      <span className="truncate text-muted">{change.label}</span>
      <span className="min-w-0 break-words">
        {kind === 'update' && (
          <>
            <span className="text-muted line-through">
              {show(change.before, change.beforeText)}
            </span>
            <span aria-hidden className="mx-1 text-muted">
              →
            </span>
            <span className="sr-only"> changes to </span>
          </>
        )}
        <span className="font-medium">{show(change.after, change.afterText)}</span>
      </span>
    </li>
  );
}

/**
 * Changes the assistant wants to make. Nothing happens until the user approves; with several
 * changes, each can be included or left out.
 */
export function ProposalCard({
  actions,
  canDecide,
  busy,
  onDecide,
  onNavigate,
}: {
  actions: ProposedAction[];
  canDecide: boolean;
  busy: boolean;
  onDecide: (decisions: { toolUseId: string; approve: boolean }[]) => void;
  onNavigate: () => void;
}) {
  const [included, setIncluded] = useState(() => new Set(actions.map((a) => a.toolUseId)));
  const pending = canDecide && actions.some((a) => a.status === 'pending');
  const several = actions.length > 1;
  const decideAll = (approve: (id: string) => boolean) =>
    onDecide(actions.map((a) => ({ toolUseId: a.toolUseId, approve: approve(a.toolUseId) })));

  return (
    <section
      aria-label="Proposed changes"
      className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3"
    >
      <h3 className="mb-2 text-sm font-semibold">
        {pending
          ? `Approve ${several ? `these ${actions.length} changes` : 'this change'}?`
          : 'Proposed changes'}
      </h3>
      <ul className="space-y-2">
        {actions.map((action) => {
          const status = STATUS[action.status];
          const title =
            action.kind === 'create'
              ? `New ${action.objectLabel.toLowerCase()}`
              : action.record?.title;
          return (
            <li key={action.toolUseId} className="rounded-lg border border-line bg-surface p-2.5">
              <div className="mb-1 flex items-start gap-2">
                {pending && several && (
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--color-accent)]"
                    checked={included.has(action.toolUseId)}
                    aria-label={`Include: ${action.kind === 'create' ? 'create' : 'update'} ${title}`}
                    onChange={(e) =>
                      setIncluded((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(action.toolUseId);
                        else next.delete(action.toolUseId);
                        return next;
                      })
                    }
                  />
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <span className="text-muted">
                    {action.kind === 'create'
                      ? 'Create'
                      : `Update ${action.objectLabel.toLowerCase()}`}{' '}
                  </span>
                  {action.kind === 'update' && action.record ? (
                    <Link
                      to={action.record.url}
                      onClick={onNavigate}
                      className="font-medium text-accent hover:underline"
                    >
                      {action.record.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{title}</span>
                  )}
                </div>
                {status && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                  >
                    {status.label}
                  </span>
                )}
              </div>
              <ul className="divide-y divide-line">
                {action.changes.map((c) => (
                  <ChangeRow key={c.field} change={c} kind={action.kind} />
                ))}
              </ul>
              {action.status === 'approved' && action.result && action.kind === 'create' && (
                <Link
                  to={action.result.url}
                  onClick={onNavigate}
                  className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
                >
                  Open {action.result.title}
                </Link>
              )}
              {action.error && <p className="mt-1 text-sm text-bad">{action.error}</p>}
            </li>
          );
        })}
      </ul>
      {pending && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => decideAll(() => false)}>
            <X aria-hidden className="size-4" />
            {several ? 'Reject all' : 'Reject'}
          </Button>
          <Button
            disabled={busy || (several && included.size === 0)}
            onClick={() => decideAll((id) => !several || included.has(id))}
          >
            <Check aria-hidden className="size-4" />
            {several
              ? `Approve ${included.size === actions.length ? 'all' : `${included.size}`}`
              : 'Approve'}
          </Button>
        </div>
      )}
    </section>
  );
}
