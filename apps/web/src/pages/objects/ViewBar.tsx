import type { ObjectMetadataDto, UpdateViewInput, ViewDto } from '@crm-replica/shared';
import { ViewType } from '@crm-replica/shared';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Columns3,
  Filter,
  Kanban,
  Pencil,
  Plus,
  Rows3,
  Trash2,
} from 'lucide-react';
import { FormEvent, ReactNode, useRef, useState } from 'react';
import { Popover } from '../../components/Popover';
import { useToast } from '../../lib/toast';
import { selectFields, useCreateView, useDeleteView, useUpdateView } from '../../lib/views';
import { FieldsMenu } from './FieldsMenu';
import { FilterBuilder } from './FilterBuilder';
import { SortBuilder } from './SortBuilder';

function ToolbarButton({
  label,
  icon,
  count,
  children,
  width = 300,
}: {
  label: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm hover:bg-raised ${count ? 'text-accent' : 'text-muted'}`}
      >
        {icon}
        {label}
        {count ? <span className="rounded-full bg-accent-soft px-1.5 text-xs">{count}</span> : null}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={width}>
          {children}
        </Popover>
      )}
    </>
  );
}

function NameForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  }
  return (
    <form onSubmit={submit} className="flex gap-1 p-1">
      <input
        autoFocus
        aria-label="View name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        maxLength={60}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
      />
      <button type="submit" className="rounded-md bg-accent px-2 text-sm text-white">
        {submitLabel}
      </button>
    </form>
  );
}

function ViewSwitcher({
  object,
  views,
  current,
  onSelect,
}: {
  object: ObjectMetadataDto;
  views: ViewDto[];
  current: ViewDto;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'new' | 'rename'>('list');
  const anchor = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const create = useCreateView(object.namePlural);
  const update = useUpdateView(object.namePlural);
  const remove = useDeleteView(object.namePlural);
  const close = () => {
    setOpen(false);
    setMode('list');
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`View: ${current.name}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-56 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium hover:bg-raised"
      >
        <span className="truncate">{current.name}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} width={260}>
          {mode === 'new' ? (
            <NameForm
              initial=""
              submitLabel="Create"
              onCancel={() => setMode('list')}
              onSubmit={(name) =>
                // A new view starts as a copy of the current one.
                create.mutate(
                  {
                    object: object.namePlural,
                    name,
                    type: current.type,
                    kanbanFieldName: current.kanbanFieldName,
                    filterConjunction: current.filterConjunction,
                    fields: current.fields.map(({ fieldName, isVisible, width }) => ({
                      fieldName,
                      isVisible,
                      width,
                    })),
                    filters: current.filters,
                    sorts: current.sorts,
                  },
                  {
                    onSuccess: (v) => (onSelect(v.id), close()),
                    onError: (e) => toast(`Couldn’t create view: ${e.message}`, 'error'),
                  },
                )
              }
            />
          ) : mode === 'rename' ? (
            <NameForm
              initial={current.name}
              submitLabel="Save"
              onCancel={() => setMode('list')}
              onSubmit={(name) =>
                update.mutate(
                  { id: current.id, changes: { name } },
                  { onSuccess: close, onError: (e) => toast(e.message, 'error') },
                )
              }
            />
          ) : (
            <>
              <ul role="listbox" aria-label="Views" className="max-h-64 overflow-y-auto py-1">
                {views.map((v) => (
                  <li key={v.id} role="option" aria-selected={v.id === current.id}>
                    <button
                      type="button"
                      onClick={() => (onSelect(v.id), close())}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-raised"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {v.type === ViewType.KANBAN ? (
                          <Kanban aria-hidden className="size-4 text-muted" />
                        ) : (
                          <Rows3 aria-hidden className="size-4 text-muted" />
                        )}
                        <span className="truncate">{v.name}</span>
                      </span>
                      {v.id === current.id && <Check aria-hidden className="size-4 text-accent" />}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-raised"
                >
                  <Plus aria-hidden className="size-4" /> New view
                </button>
                <button
                  type="button"
                  onClick={() => setMode('rename')}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-raised"
                >
                  <Pencil aria-hidden className="size-4" /> Rename “{current.name}”
                </button>
                {!current.isDefault && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Delete the view “${current.name}”? Records aren’t affected.`))
                        return;
                      remove.mutate(current.id, {
                        onSuccess: () => (onSelect(views.find((v) => v.isDefault)!.id), close()),
                        onError: (e) => toast(e.message, 'error'),
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-bad hover:bg-raised"
                  >
                    <Trash2 aria-hidden className="size-4" /> Delete view
                  </button>
                )}
              </div>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

/** View switcher plus the tools that change the current view; every change is saved to it. */
export function ViewBar({
  object,
  objects,
  views,
  view,
  onSelectView,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  views: ViewDto[];
  view: ViewDto;
  onSelectView: (id: string) => void;
}) {
  const toast = useToast();
  const update = useUpdateView(object.namePlural);
  const save = (changes: UpdateViewInput) =>
    update.mutate(
      { id: view.id, changes },
      { onError: (e) => toast(`Couldn’t save view: ${e.message}`, 'error') },
    );
  const groupable = selectFields(object);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-1.5">
      <ViewSwitcher object={object} views={views} current={view} onSelect={onSelectView} />
      <div role="radiogroup" aria-label="Layout" className="ml-1 flex rounded-lg bg-raised p-0.5">
        {[
          { type: ViewType.TABLE, label: 'Table', icon: <Rows3 aria-hidden className="size-4" /> },
          {
            type: ViewType.KANBAN,
            label: 'Kanban',
            icon: <Kanban aria-hidden className="size-4" />,
          },
        ].map((option) => {
          const disabled = option.type === ViewType.KANBAN && groupable.length === 0;
          return (
            <button
              key={option.type}
              type="button"
              role="radio"
              aria-checked={view.type === option.type}
              disabled={disabled}
              title={
                disabled ? `Add a select field to ${object.labelPlural} to use kanban` : undefined
              }
              onClick={() =>
                // Kanban needs a field to group by; pick one up front so the board can render right away.
                save(
                  option.type === ViewType.KANBAN && !view.kanbanFieldName
                    ? { type: option.type, kanbanFieldName: groupable[0]?.name ?? null }
                    : { type: option.type },
                )
              }
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-sm disabled:opacity-40 ${
                view.type === option.type ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
      {view.type === ViewType.KANBAN && groupable.length > 1 && (
        <label className="ml-1 flex items-center gap-1 text-sm text-muted">
          Group by
          <select
            value={view.kanbanFieldName ?? ''}
            onChange={(e) => save({ kanbanFieldName: e.target.value })}
            className="rounded-md border border-line bg-surface px-1 py-0.5 text-sm text-ink"
          >
            {groupable.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <ToolbarButton
          label="Filter"
          icon={<Filter aria-hidden className="size-4" />}
          count={view.filters.length}
          width={560}
        >
          <FilterBuilder
            object={object}
            objects={objects}
            view={view}
            onChange={(filters, filterConjunction) => save({ filters, filterConjunction })}
          />
        </ToolbarButton>
        <ToolbarButton
          label="Sort"
          icon={<ArrowUpDown aria-hidden className="size-4" />}
          count={view.sorts.length}
          width={360}
        >
          <SortBuilder object={object} sorts={view.sorts} onChange={(sorts) => save({ sorts })} />
        </ToolbarButton>
        <ToolbarButton
          label="Fields"
          icon={<Columns3 aria-hidden className="size-4" />}
          width={260}
        >
          <FieldsMenu
            object={object}
            fields={view.fields}
            onChange={(fields) =>
              save({
                fields: fields.map(({ fieldName, isVisible, width }) => ({
                  fieldName,
                  isVisible,
                  width,
                })),
              })
            }
          />
        </ToolbarButton>
      </div>
    </div>
  );
}
