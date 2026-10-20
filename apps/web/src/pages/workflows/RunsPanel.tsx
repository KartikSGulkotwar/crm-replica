import type { StepRunDto, WorkflowRunDto, WorkflowRunStatus } from '@crm-replica/shared';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Card, FormError, Spinner } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useWorkflowRuns } from '../../lib/workflows';

const STATUS_CLASS: Record<WorkflowRunStatus | StepRunDto['status'], string> = {
  QUEUED: 'bg-raised text-muted',
  RUNNING: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  WAITING: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-200',
  SUCCEEDED: 'bg-ok/10 text-ok',
  FAILED: 'bg-bad/10 text-bad',
  SKIPPED: 'bg-raised text-muted',
};

export function StatusBadge({ status }: { status: WorkflowRunStatus | StepRunDto['status'] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

function duration(run: { startedAt: string | null; finishedAt: string | null }) {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function RunDetail({ run }: { run: WorkflowRunDto }) {
  return (
    <div className="space-y-3 border-t border-line bg-canvas/50 p-3">
      {run.error && <FormError error={new Error(run.error)} />}
      <Json label="Trigger" value={run.trigger} />
      {run.steps.length === 0 && <p className="text-xs text-muted">No steps ran.</p>}
      <ol className="space-y-2">
        {run.steps.map((s) => (
          <li
            key={s.stepId}
            className="rounded-md border border-line bg-surface p-2"
            data-testid={`run-step-${s.stepId}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={s.status} />
              <span className="font-medium">{s.name}</span>
              <code className="font-mono text-xs text-muted">{s.stepId}</code>
              {s.attempts > 1 && <span className="text-xs text-muted">{s.attempts} attempts</span>}
              {s.resumeAt && s.status === 'WAITING' && (
                <span className="text-xs text-muted">continues {formatDateTime(s.resumeAt)}</span>
              )}
              {duration(s) && <span className="ml-auto text-xs text-muted">{duration(s)}</span>}
            </div>
            {s.error && <p className="mt-1 text-xs text-bad">{s.error}</p>}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Json label="Input" value={s.input} />
              <Json label="Output" value={s.output} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Run history with per-step input, output and errors. Refreshes while runs are in progress. */
export function RunsPanel({ workflowId }: { workflowId: string }) {
  const runs = useWorkflowRuns(workflowId);
  const [open, setOpen] = useState<string | null>(null);
  if (runs.isPending) return <Spinner />;
  if (runs.isError) return <FormError error={runs.error} />;
  return (
    <Card title={`Runs (${runs.data.length})`}>
      {runs.data.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          No runs yet. Use “Test run”, or trigger the workflow.
        </p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Runs">
          {runs.data.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setOpen(open === run.id ? null : run.id)}
                aria-expanded={open === run.id}
                className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-raised"
              >
                <ChevronRight
                  aria-hidden
                  className={`size-4 text-muted transition-transform ${open === run.id ? 'rotate-90' : ''}`}
                />
                <StatusBadge status={run.status} />
                <span className="text-sm">{formatDateTime(run.createdAt)}</span>
                <span className="text-xs text-muted">v{run.version}</span>
                {run.isTest && (
                  <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">
                    test
                  </span>
                )}
                {run.depth > 0 && (
                  <span className="text-xs text-muted">triggered by an automation</span>
                )}
                <span className="ml-auto text-xs text-muted">
                  {run.steps.filter((s) => s.status === 'SUCCEEDED').length}/{run.steps.length}{' '}
                  steps{duration(run) ? ` · ${duration(run)}` : ''}
                </span>
              </button>
              {open === run.id && <RunDetail run={run} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
