import type {
  CurrencyValue,
  ObjectMetadataDto,
  TimelineChange,
  TimelineEventDto,
} from '@crm-replica/shared';
import { FieldType } from '@crm-replica/shared';
import {
  CheckCircle2,
  CirclePlus,
  ListTodo,
  Pencil,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { findObjectByName } from '../../lib/metadata';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '../../lib/format';

const ICONS: Record<TimelineEventDto['kind'], ReactNode> = {
  created: <CirclePlus aria-hidden className="size-3.5" />,
  updated: <Pencil aria-hidden className="size-3.5" />,
  deleted: <Trash2 aria-hidden className="size-3.5" />,
  restored: <RotateCcw aria-hidden className="size-3.5" />,
  note_added: <StickyNote aria-hidden className="size-3.5" />,
  task_added: <ListTodo aria-hidden className="size-3.5" />,
  task_completed: <CheckCircle2 aria-hidden className="size-3.5" />,
};

/** Who did it: a person, a workflow, the assistant on someone's behalf… */
export function actorText(event: TimelineEventDto): string {
  const name = event.actor?.name ?? 'Someone';
  switch (event.source) {
    case 'workflow':
      return event.sourceLabel ? `Workflow “${event.sourceLabel}”` : 'A workflow';
    case 'agent':
      return `${name} (via Ask the CRM)`;
    case 'api':
      return `${name} (via API key)`;
    case 'demo':
      return 'Demo data';
    default:
      return name;
  }
}

/** A changed value as text, using the field's type when the server didn't give a label. */
export function valueText(
  value: unknown,
  text: string | undefined,
  type: FieldType | undefined,
): string {
  if (text) return text;
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'empty';
  switch (type) {
    case FieldType.CURRENCY:
      return formatCurrency(value as CurrencyValue) || 'empty';
    case FieldType.NUMBER:
      return typeof value === 'number' ? formatNumber(value) : String(value);
    case FieldType.DATE:
      return typeof value === 'string' ? formatDate(value) : String(value);
    case FieldType.DATE_TIME:
      return typeof value === 'string' ? formatDateTime(value) : String(value);
    case FieldType.BOOLEAN:
      return value ? 'Yes' : 'No';
    case FieldType.RATING:
      return `${String(value)} ★`;
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

function Change({ change, object }: { change: TimelineChange; object?: ObjectMetadataDto }) {
  const field = object?.fields.find(
    (f) => f.name === change.field || `${f.name}Id` === change.field,
  );
  const before = valueText(change.before, change.beforeText, field?.type);
  const after = valueText(change.after, change.afterText, field?.type);
  return (
    <li className="break-words">
      <span className="text-muted">{change.label}: </span>
      <span className="text-muted line-through decoration-muted/60">{before}</span>
      <span aria-hidden className="mx-1 text-muted">
        →
      </span>
      <span className="sr-only"> changed to </span>
      <span className="font-medium">{after}</span>
    </li>
  );
}

function Sentence({ event, showRecord }: { event: TimelineEventDto; showRecord: boolean }) {
  const actor = <span className="font-medium">{actorText(event)}</span>;
  const record = showRecord ? (
    <>
      {' '}
      {event.record.url ? (
        <Link to={event.record.url} className="font-medium text-accent hover:underline">
          {event.record.title}
        </Link>
      ) : (
        <span className="font-medium">{event.record.title}</span>
      )}
    </>
  ) : null;
  const what = event.record.objectLabel.toLowerCase();
  const activity = event.activity && (
    <Link to={event.activity.url} className="font-medium text-accent hover:underline">
      {event.activity.title}
    </Link>
  );
  switch (event.kind) {
    case 'created':
      return (
        <>
          {actor} created{' '}
          {showRecord ? (
            <>
              {what}
              {record}
            </>
          ) : (
            `this ${what}`
          )}
        </>
      );
    case 'updated':
      return (
        <>
          {actor} updated {showRecord ? record : `this ${what}`}
        </>
      );
    case 'deleted':
      return (
        <>
          {actor} deleted{' '}
          {showRecord ? (
            <>
              {what}
              {record}
            </>
          ) : (
            `this ${what}`
          )}
        </>
      );
    case 'restored':
      return (
        <>
          {actor} restored{' '}
          {showRecord ? (
            <>
              {what}
              {record}
            </>
          ) : (
            `this ${what}`
          )}
        </>
      );
    case 'note_added':
      return (
        <>
          {actor} added the note {activity}
          {showRecord && <> to{record}</>}
        </>
      );
    case 'task_added':
      return (
        <>
          {actor} added the task {activity}
          {showRecord && <> to{record}</>}
        </>
      );
    case 'task_completed':
      return (
        <>
          {actor} completed {activity}
          {showRecord && <> on{record}</>}
        </>
      );
  }
}

/** A list of history entries. `showRecord` names the record (for feeds spanning records). */
export function TimelineList({
  events,
  objects,
  showRecord = false,
}: {
  events: TimelineEventDto[];
  objects: ObjectMetadataDto[];
  showRecord?: boolean;
}) {
  return (
    <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[0.6875rem] before:w-px before:bg-line">
      {events.map((event) => (
        <li key={event.id} className="relative flex gap-3">
          <span className="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted">
            {ICONS[event.kind]}
          </span>
          <div className="min-w-0 flex-1 pt-0.5 text-sm">
            <p className="break-words">
              <Sentence event={event} showRecord={showRecord} />
            </p>
            {event.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {event.changes.map((c) => (
                  <Change
                    key={c.field}
                    change={c}
                    object={findObjectByName(objects, event.record.object)}
                  />
                ))}
              </ul>
            )}
            <time
              dateTime={event.createdAt}
              title={formatDateTime(event.createdAt)}
              className="text-xs text-muted"
            >
              {formatRelative(event.createdAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
