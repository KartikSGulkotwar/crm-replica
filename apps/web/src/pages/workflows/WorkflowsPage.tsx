import { ChevronRight, Plus, Workflow } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { Button, Card, FormError, FullPageSpinner, TextField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useObjects } from '../../lib/metadata';
import { useIsAdmin } from '../../lib/session';
import { useCreateWorkflow, useWorkflows } from '../../lib/workflows';
import { describeTrigger } from './editor/TriggerEditor';
import { StatusBadge } from './RunsPanel';

function NewWorkflowDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  function submit(e?: FormEvent) {
    e?.preventDefault();
    create.mutate({ name: name.trim() }, { onSuccess: (wf) => navigate(`/workflows/${wf.id}`) });
  }
  return (
    <Dialog
      title="New workflow"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} disabled={!name.trim()} loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <TextField
          label="Name"
          autoFocus
          placeholder="e.g. Follow up on won deals"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}

export function WorkflowsPage() {
  const workflows = useWorkflows();
  const { data: objects = [] } = useObjects();
  const isAdmin = useIsAdmin();
  const [creating, setCreating] = useState(false);
  if (workflows.isPending) return <FullPageSpinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted">“When this happens, do that”, run in the background.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New workflow
          </Button>
        )}
      </header>
      {workflows.isError ? (
        <FormError error={workflows.error} />
      ) : workflows.data.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <Workflow aria-hidden className="mx-auto size-10 text-muted/50" />
            <h2 className="mt-3 font-medium">No workflows yet</h2>
            <p className="mt-1 text-sm text-muted">
              For example: when an opportunity moves to Won, create a task and email the team.
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {workflows.data.map((wf) => {
              const definition = (wf.activeVersion ?? wf.draftVersion)?.definition;
              return (
                <li key={wf.id}>
                  <Link
                    to={`/workflows/${wf.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-raised"
                  >
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${wf.isActive ? 'bg-ok' : 'bg-muted/40'}`}
                      aria-label={wf.isActive ? 'Active' : 'Off'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {wf.name}
                        {wf.draftVersion && (
                          <span className="rounded bg-yellow-500/20 px-1.5 text-[11px] font-normal text-yellow-800 dark:text-yellow-200">
                            draft
                          </span>
                        )}
                        {wf.managedByApp && (
                          <span className="rounded bg-raised px-1.5 text-[11px] font-normal text-muted">
                            as code
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {definition ? describeTrigger(definition.trigger, objects) : ''}
                      </span>
                    </span>
                    {wf.lastRun && (
                      <span className="hidden items-center gap-2 text-xs text-muted sm:flex">
                        <StatusBadge status={wf.lastRun.status} />{' '}
                        {formatDateTime(wf.lastRun.createdAt)}
                      </span>
                    )}
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {creating && <NewWorkflowDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
