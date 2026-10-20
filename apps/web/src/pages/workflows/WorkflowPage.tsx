import type { WorkflowDefinition, WorkflowDto } from '@crm-replica/shared';
import { ArrowLeft, FlaskConical, Power, Rocket, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, FormError, FullPageSpinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useObjects } from '../../lib/metadata';
import { useIsAdmin } from '../../lib/session';
import { useToast } from '../../lib/toast';
import {
  useDeactivate,
  useDeleteWorkflow,
  useDiscardDraft,
  usePublish,
  useRenameWorkflow,
  useSaveDraft,
  useTestRun,
  useWorkflow,
} from '../../lib/workflows';
import { NotFoundPage } from '../NotFoundPage';
import { StepsEditor } from './editor/StepsEditor';
import { TriggerEditor } from './editor/TriggerEditor';
import { RunsPanel } from './RunsPanel';

/** Problems come back as a list (400 with message: string[]). */
const problemsOf = (error: unknown): string[] =>
  error instanceof ApiError && Array.isArray((error.body as { message?: unknown })?.message)
    ? (error.body as { message: string[] }).message
    : [];

function Editor({ workflow, editable }: { workflow: WorkflowDto; editable: boolean }) {
  const toast = useToast();
  const { data: objects = [] } = useObjects();
  const source = workflow.draftVersion ?? workflow.activeVersion;
  const [definition, setDefinition] = useState<WorkflowDefinition>(source!.definition);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const save = useSaveDraft(workflow.id);
  const publish = usePublish(workflow.id);
  const test = useTestRun(workflow.id);
  const discard = useDiscardDraft(workflow.id);
  const [tab, setTab] = useState<'editor' | 'runs'>('editor');

  // Reload when the server's version changes (publish, discard) and nothing is being edited.
  useEffect(() => {
    if (!dirty) setDefinition((workflow.draftVersion ?? workflow.activeVersion)!.definition);
  }, [workflow.draftVersion, workflow.activeVersion, dirty]);

  const edit = (next: WorkflowDefinition) => {
    setDefinition(next);
    setDirty(true);
  };

  async function saveDraft(): Promise<boolean> {
    try {
      const res = await save.mutateAsync(definition);
      setProblems(res.problems);
      setDirty(false);
      return res.problems.length === 0;
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`, 'error');
      return false;
    }
  }

  async function onPublish() {
    if (dirty && !(await saveDraft())) return;
    publish.mutate(undefined, {
      onSuccess: () => {
        setProblems([]);
        toast('Published. The workflow is active.');
      },
      onError: (e) =>
        problemsOf(e).length ? setProblems(problemsOf(e)) : toast(e.message, 'error'),
    });
  }

  async function onTest() {
    if (dirty && !(await saveDraft())) return;
    test.mutate(undefined, {
      onSuccess: () => {
        setTab('runs');
        toast('Test run started');
      },
      onError: (e) =>
        problemsOf(e).length ? setProblems(problemsOf(e)) : toast(e.message, 'error'),
    });
  }

  const hasDraft = Boolean(workflow.draftVersion) || dirty;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-raised p-0.5" aria-label="Workflow tabs">
          {(['editor', 'runs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${tab === t ? 'bg-surface shadow-sm' : 'text-muted'}`}
            >
              {t}
            </button>
          ))}
        </nav>
        {editable && (
          <div className="ml-auto flex flex-wrap gap-2">
            {workflow.draftVersion && workflow.activeVersion && !dirty && (
              <Button
                variant="ghost"
                loading={discard.isPending}
                onClick={() =>
                  confirm('Throw away the draft and go back to the published version?') &&
                  discard.mutate()
                }
              >
                <Undo2 aria-hidden className="size-4" /> Discard draft
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void saveDraft()}
              disabled={!dirty}
              loading={save.isPending}
            >
              <Save aria-hidden className="size-4" /> Save draft
            </Button>
            <Button variant="secondary" onClick={() => void onTest()} loading={test.isPending}>
              <FlaskConical aria-hidden className="size-4" /> Test run
            </Button>
            <Button
              onClick={() => void onPublish()}
              disabled={!hasDraft}
              loading={publish.isPending}
            >
              <Rocket aria-hidden className="size-4" /> Publish
            </Button>
          </div>
        )}
      </div>

      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm">
          <p className="font-medium text-bad">Fix these before publishing or testing:</p>
          <ul className="mt-1 list-disc pl-5 text-bad">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'editor' ? (
        <>
          <Card title="Trigger">
            <div className="p-4">
              <TriggerEditor
                definition={definition}
                objects={objects}
                readOnly={!editable}
                onChange={(trigger) => edit({ ...definition, trigger })}
              />
            </div>
          </Card>
          <Card title="Steps">
            <div className="p-4">
              <StepsEditor
                definition={definition}
                objects={objects}
                readOnly={!editable}
                problems={problems}
                onChange={(steps) => edit({ ...definition, steps })}
              />
            </div>
          </Card>
          {!editable && <p className="text-xs text-muted">Only admins can change workflows.</p>}
        </>
      ) : (
        <RunsPanel workflowId={workflow.id} />
      )}
    </>
  );
}

export function WorkflowPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const workflow = useWorkflow(id);
  const rename = useRenameWorkflow(id);
  const deactivate = useDeactivate(id);
  const remove = useDeleteWorkflow(id);
  const [name, setName] = useState<string | null>(null);

  if (workflow.isPending) return <FullPageSpinner />;
  if (workflow.isError)
    return workflow.error instanceof ApiError && workflow.error.status === 404 ? (
      <NotFoundPage />
    ) : (
      <div className="p-6">
        <FormError error={workflow.error} />
      </div>
    );
  const wf = workflow.data;
  const editable = isAdmin && !wf.managedByApp;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-8">
      <Link
        to="/workflows"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> Workflows
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isAdmin ? (
            <input
              aria-label="Workflow name"
              value={name ?? wf.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() =>
                name &&
                name.trim() &&
                name !== wf.name &&
                rename.mutate(
                  { name: name.trim() },
                  { onError: (e) => toast(e.message, 'error'), onSettled: () => setName(null) },
                )
              }
              className="w-full rounded-md bg-transparent px-1 -mx-1 text-xl font-semibold outline-none hover:bg-raised focus:bg-raised"
            />
          ) : (
            <h1 className="text-xl font-semibold">{wf.name}</h1>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${wf.isActive ? 'bg-ok/10 text-ok' : 'bg-raised'}`}
            >
              {wf.isActive ? `Active · v${wf.activeVersion?.version}` : 'Off'}
            </span>
            {wf.draftVersion && (
              <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-yellow-800 dark:text-yellow-200">
                Draft v{wf.draftVersion.version}
              </span>
            )}
            {wf.nextRunAt && <span>Next run {new Date(wf.nextRunAt).toLocaleString()}</span>}
            {wf.managedByApp && (
              <span>Managed as code by app “{wf.managedByApp}” (edit it there)</span>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {wf.isActive && (
              <Button
                variant="secondary"
                loading={deactivate.isPending}
                onClick={() =>
                  deactivate.mutate(undefined, { onSuccess: () => toast('Workflow turned off') })
                }
              >
                <Power aria-hidden className="size-4" /> Turn off
              </Button>
            )}
            <Button
              variant="danger"
              aria-label="Delete workflow"
              onClick={() =>
                confirm(`Delete “${wf.name}” and its run history?`) &&
                remove.mutate(undefined, { onSuccess: () => navigate('/workflows') })
              }
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        )}
      </header>
      <Editor key={wf.id} workflow={wf} editable={editable} />
    </div>
  );
}
