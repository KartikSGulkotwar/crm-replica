import type { ActivityDto, ObjectMetadataDto, RecordRef } from '@crm-replica/shared';
import { Plus } from 'lucide-react';
import { FormEvent, ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCreateActivity,
  useRecordActivities,
  useTimeline,
  useUpdateActivity,
} from '../../lib/activities';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { Button, FormError, Spinner } from '../ui';
import { TimelineList } from './Timeline';

type Tab = 'timeline' | 'notes' | 'tasks';

function OtherLinks({ targets, self }: { targets: RecordRef[]; self: string }) {
  const others = targets.filter((t) => t.id !== self);
  if (!others.length) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
      Also on
      {others.map((t) => (
        <Link
          key={`${t.object}:${t.id}`}
          to={t.url}
          className="rounded-full border border-line px-1.5 py-px hover:border-accent hover:text-accent"
        >
          {t.title}
        </Link>
      ))}
    </p>
  );
}

function NoteForm({
  onSave,
  onCancel,
  pending,
}: {
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() || body.trim())
      onSave(title.trim() || body.trim().split('\n')[0].slice(0, 80), body.trim());
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-line p-3">
      <input
        aria-label="Note title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        autoFocus
        className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted/70"
      />
      <textarea
        aria-label="Note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a note…"
        rows={4}
        className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-muted/70"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim() && !body.trim()}>
          Save note
        </Button>
      </div>
    </form>
  );
}

function Notes({
  notes,
  self,
  onAdd,
  adding,
}: {
  notes: ActivityDto[];
  self: string;
  onAdd: (title: string, body: string) => Promise<unknown>;
  adding: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      {open ? (
        <NoteForm
          pending={adding}
          onCancel={() => setOpen(false)}
          onSave={(title, body) => void onAdd(title, body).then(() => setOpen(false))}
        />
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden className="size-4" /> New note
        </Button>
      )}
      {notes.length === 0 && !open && <p className="text-sm text-muted">No notes yet.</p>}
      <ul className="space-y-3">
        {notes.map(({ record, targets }) => (
          <li key={record.id} className="rounded-lg border border-line p-3">
            <Link
              to={`/objects/notes/${record.id}`}
              className="text-sm font-medium hover:text-accent"
            >
              {(record.title as string) || 'Untitled note'}
            </Link>
            {typeof record.body === 'string' && record.body && (
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-sm">
                {record.body}
              </p>
            )}
            <p
              className="mt-1 text-xs text-muted"
              title={formatDateTime(record.createdAt as string)}
            >
              {formatRelative(record.createdAt as string)}
            </p>
            <OtherLinks targets={targets} self={self} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function dueLabel(due: string | null, done: boolean): { text: string; className: string } | null {
  if (!due) return null;
  const date = new Date(due);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const overdue = !done && date < today && !sameDay;
  return {
    text: sameDay ? 'Today' : formatRelative(due),
    className: overdue ? 'text-bad' : sameDay && !done ? 'text-warn' : 'text-muted',
  };
}

function Tasks({
  tasks,
  self,
  onAdd,
  adding,
}: {
  tasks: ActivityDto[];
  self: string;
  onAdd: (title: string, due: string) => Promise<unknown>;
  adding: boolean;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const update = useUpdateActivity();
  const toast = useToast();
  const dueId = useId();
  // Ticks show at once; the saved status replaces them when the list refreshes.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const setTick = (id: string, value: boolean | undefined) =>
    setTicked(({ [id]: _, ...rest }) => (value === undefined ? rest : { ...rest, [id]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void onAdd(title.trim(), due).then(() => {
      setTitle('');
      setDue('');
    });
  };
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="New task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <label htmlFor={dueId} className="sr-only">
          Due date
        </label>
        <input
          id={dueId}
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-muted"
        />
        <Button type="submit" loading={adding} disabled={!title.trim()}>
          Add
        </Button>
      </form>
      {tasks.length === 0 && <p className="text-sm text-muted">No tasks yet.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {tasks.map(({ record, targets }) => {
          const done = ticked[record.id] ?? record.status === 'DONE';
          const label = dueLabel(record.dueDate as string | null, done);
          const title = (record.title as string) || 'Untitled task';
          return (
            <li key={record.id} className="flex items-start gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={done}
                aria-label={`Done: ${title}`}
                className="mt-1 size-4 accent-[var(--color-accent)]"
                onChange={(e) => {
                  const next = e.target.checked;
                  setTick(record.id, next);
                  update.mutate(
                    { kind: 'tasks', id: record.id, values: { status: next ? 'DONE' : 'TO_DO' } },
                    {
                      onSettled: () => setTick(record.id, undefined),
                      onError: (err) =>
                        toast(`Couldn’t update the task: ${(err as Error).message}`, 'error'),
                    },
                  );
                }}
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/objects/tasks/${record.id}`}
                  className={`text-sm hover:text-accent ${done ? 'text-muted line-through' : ''}`}
                >
                  {title}
                </Link>
                <div className="flex flex-wrap gap-x-2 text-xs">
                  {label && <span className={label.className}>Due {label.text}</span>}
                  {record.status === 'IN_PROGRESS' && (
                    <span className="text-accent">In progress</span>
                  )}
                </div>
                <OtherLinks targets={targets} self={self} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TimelineTab({
  plural,
  id,
  objects,
}: {
  plural: string;
  id: string;
  objects: ObjectMetadataDto[];
}) {
  const timeline = useTimeline(plural, id);
  if (timeline.isPending) return <Spinner />;
  if (timeline.isError) return <FormError error={timeline.error} />;
  const events = timeline.data.pages.flatMap((p) => p.data);
  if (!events.length) return <p className="text-sm text-muted">No history yet.</p>;
  return (
    <div className="space-y-4">
      <TimelineList events={events} objects={objects} />
      {timeline.hasNextPage && (
        <Button
          variant="ghost"
          loading={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Show older
        </Button>
      )}
    </div>
  );
}

/**
 * The bottom of a record page: its history, plus notes and tasks for records that can have
 * them (notes and tasks themselves only get the history).
 */
export function ActivityPanel({
  object,
  objects,
  id,
  withNotesAndTasks,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  id: string;
  withNotesAndTasks: boolean;
}) {
  const [tab, setTab] = useState<Tab>('timeline');
  const activities = useRecordActivities(object.namePlural, id, withNotesAndTasks);
  const create = useCreateActivity();
  const toast = useToast();
  const me = useSession().data?.user.id;
  const baseId = useId();
  const self = [{ object: object.nameSingular, id }];

  const add = (kind: 'notes' | 'tasks', values: Record<string, unknown>) =>
    create.mutateAsync({ kind, values, targets: self }).catch((e: Error) => {
      toast(`Couldn’t save: ${e.message}`, 'error');
      throw e;
    });

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'timeline', label: 'Timeline' },
    ...(withNotesAndTasks
      ? [
          { key: 'notes' as Tab, label: 'Notes', count: activities.data?.notes.length },
          {
            key: 'tasks' as Tab,
            label: 'Tasks',
            count: activities.data?.tasks.filter((t) => t.record.status !== 'DONE').length,
          },
        ]
      : []),
  ];
  let body: ReactNode;
  if (tab === 'timeline')
    body = <TimelineTab plural={object.namePlural} id={id} objects={objects} />;
  else if (activities.isPending) body = <Spinner />;
  else if (activities.isError) body = <FormError error={activities.error} />;
  else if (tab === 'notes')
    body = (
      <Notes
        notes={activities.data.notes}
        self={id}
        adding={create.isPending}
        onAdd={(title, text) => add('notes', { title, body: text })}
      />
    );
  else
    body = (
      <Tasks
        tasks={activities.data.tasks}
        self={id}
        adding={create.isPending}
        onAdd={(title, due) =>
          add('tasks', {
            title,
            ...(due ? { dueDate: new Date(`${due}T17:00:00`).toISOString() } : {}),
            ...(me ? { assigneeId: me } : {}),
          })
        }
      />
    );

  return (
    <section className="rounded-xl border border-line bg-surface shadow-sm" aria-label="Activity">
      <div
        role="tablist"
        aria-label="Activity"
        className="flex gap-1 overflow-x-auto border-b border-line px-2"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${baseId}-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${baseId}-panel`}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${
              tab === t.key
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-raised px-1.5 text-xs text-muted">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-${tab}`}
        className="p-4"
      >
        {body}
      </div>
    </section>
  );
}
