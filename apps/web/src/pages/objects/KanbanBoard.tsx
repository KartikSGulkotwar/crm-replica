import type {
  FieldMetadataDto,
  ObjectMetadataDto,
  RecordDto,
  SelectOption,
  ViewDto,
} from '@crm-replica/shared';
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FieldDisplay, OptionChip } from '../../components/fields/Field';
import { Spinner } from '../../components/ui';
import { recordLabel } from '../../lib/record-label';
import { fieldKey, relationExpands, useRecordsInfinite, useUpdateRecord } from '../../lib/records';
import { useToast } from '../../lib/toast';
import { selectFields, viewFilter, viewSort } from '../../lib/views';

const NONE = '__none';
/** The board loads at most this many pages (of 50) so huge objects stay responsive. */
const MAX_PAGES = 10;

function Card({
  record,
  object,
  objects,
  cardFields,
  overlay,
}: {
  record: RecordDto;
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  cardFields: FieldMetadataDto[];
  overlay?: boolean;
}) {
  const sortable = useSortable({ id: record.id, disabled: overlay });
  // Cards stay compact: empty values are left out.
  const shown = cardFields.filter((f) => {
    const v = record[fieldKey(f)];
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  return (
    <li
      ref={overlay ? undefined : sortable.setNodeRef}
      style={
        overlay
          ? undefined
          : {
              transform: CSS.Translate.toString(sortable.transform),
              transition: sortable.transition,
            }
      }
      {...(overlay ? {} : sortable.attributes)}
      {...(overlay ? {} : sortable.listeners)}
      aria-label={recordLabel(object, record)}
      data-testid="kanban-card"
      className={`relative cursor-grab touch-none list-none rounded-lg border border-line bg-surface p-2.5 text-sm shadow-sm ${
        sortable.isDragging && !overlay ? 'opacity-40' : ''
      } ${overlay ? 'rotate-2 shadow-lg' : 'hover:border-accent/40'}`}
    >
      <Link
        to={`/objects/${object.namePlural}/${record.id}`}
        className="block truncate font-medium hover:text-accent"
      >
        {recordLabel(object, record)}
      </Link>
      {shown.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {shown.map((field) => (
            <div key={field.id} className="flex min-w-0 items-center gap-2 text-xs">
              <dt className="sr-only">{field.label}</dt>
              <dd className="min-w-0 truncate text-muted">
                <FieldDisplay field={field} record={record} objects={objects} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Column({
  id,
  option,
  label,
  count,
  children,
}: {
  id: string;
  option?: SelectOption;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const droppable = useDroppable({ id: `column:${id}` });
  return (
    <section
      ref={droppable.setNodeRef}
      aria-label={label}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-raised/60 ${droppable.isOver ? 'ring-2 ring-accent/40' : ''}`}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        {option ? (
          <OptionChip option={option} />
        ) : (
          <span className="text-sm text-muted">{label}</span>
        )}
        <span className="text-xs text-muted">{count}</span>
      </header>
      <ul className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</ul>
    </section>
  );
}

/** Position between two neighbours, so a dropped card lands exactly where it was dropped. */
export function positionBetween(
  prev: RecordDto | undefined,
  next: RecordDto | undefined,
  current: number,
): number {
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return current;
}

/**
 * Records as cards in columns, one per option of the view's select field (plus "No value").
 * Dragging a card saves the new option and its position in one update.
 */
export function KanbanBoard({
  object,
  objects,
  view,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  view: ViewDto;
}) {
  const toast = useToast();
  // Fall back to the first select field if the view's field is missing (e.g. just deleted).
  const field =
    object.fields.find((f) => f.name === view.kanbanFieldName) ?? selectFields(object)[0];
  const sorted = view.sorts.length > 0;
  const records = useRecordsInfinite(object.namePlural, {
    filter: viewFilter(view),
    sort: viewSort(view) ?? 'position:asc',
    expand: relationExpands(object),
  });
  const update = useUpdateRecord(object.namePlural);
  const [dragging, setDragging] = useState<RecordDto | null>(null);

  // Load every page (up to the cap) so each column is complete.
  const pages = records.data?.pages.length ?? 0;
  useEffect(() => {
    if (records.hasNextPage && !records.isFetchingNextPage && pages < MAX_PAGES)
      void records.fetchNextPage();
  }, [records, pages]);

  const cardFields = useMemo(
    () =>
      view.fields
        .filter(
          (vf) =>
            vf.isVisible &&
            vf.fieldName !== object.labelIdentifierFieldName &&
            vf.fieldName !== field?.name,
        )
        .map((vf) => object.fields.find((f) => f.name === vf.fieldName))
        .filter((f): f is FieldMetadataDto => Boolean(f))
        .slice(0, 3),
    [view.fields, object, field?.name],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!field)
    return (
      <p className="p-6 text-sm text-muted">
        Add a select field to {object.labelPlural} to group them on a board.
      </p>
    );
  const all = records.data?.pages.flatMap((p) => p.data) ?? [];
  const columnKey = (r: RecordDto) =>
    typeof r[field.name] === 'string' && field.options?.some((o) => o.value === r[field.name])
      ? (r[field.name] as string)
      : NONE;
  const columns = [
    ...(field.options ?? []).map((o) => ({
      id: o.value,
      option: o as SelectOption | undefined,
      label: o.label,
    })),
    { id: NONE, option: undefined, label: `No ${field.label.toLowerCase()}` },
  ];
  const cardsIn = (id: string) => {
    const cards = all.filter((r) => columnKey(r) === id);
    // With no sort, cards follow their manual position (updated optimistically on drop).
    return sorted ? cards : [...cards].sort((a, b) => a.position - b.position);
  };

  function onDragStart(e: DragStartEvent) {
    setDragging(all.find((r) => r.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const card = all.find((r) => r.id === e.active.id);
    if (!card || !e.over) return;
    const overId = String(e.over.id);
    const overCard = all.find((r) => r.id === overId);
    const target = overId.startsWith('column:')
      ? overId.slice('column:'.length)
      : overCard
        ? columnKey(overCard)
        : null;
    if (!target) return;
    const from = columnKey(card);
    if (sorted && target === from) return; // order comes from the view's sort

    const others = cardsIn(target).filter((r) => r.id !== card.id);
    let index = overCard ? others.findIndex((r) => r.id === overCard.id) : others.length;
    if (
      overCard &&
      from === target &&
      cardsIn(target).findIndex((r) => r.id === card.id) <
        cardsIn(target).findIndex((r) => r.id === overCard.id)
    )
      index += 1;
    const values: Record<string, unknown> = {};
    if (target !== from) values[field.name] = target === NONE ? null : target;
    if (!sorted) {
      const position = positionBetween(others[index - 1], others[index], card.position);
      if (position !== card.position) values.position = position;
    }
    if (Object.keys(values).length === 0) return;
    update.mutate(
      { id: card.id, values },
      { onError: (err) => toast(`Couldn’t move card: ${(err as Error).message}`, 'error') },
    );
  }

  if (records.isPending)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  if (records.isError)
    return <p className="p-6 text-sm text-bad">Couldn’t load records: {records.error.message}</p>;

  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex h-full gap-3 p-3">
          {columns.map((col) => {
            const cards = cardsIn(col.id);
            if (col.id === NONE && cards.length === 0 && !dragging) return null;
            return (
              <Column
                key={col.id}
                id={col.id}
                option={col.option}
                label={col.label}
                count={cards.length}
              >
                <SortableContext
                  items={cards.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {cards.map((r) => (
                    <Card
                      key={r.id}
                      record={r}
                      object={object}
                      objects={objects}
                      cardFields={cardFields}
                    />
                  ))}
                </SortableContext>
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {dragging && (
            <Card
              record={dragging}
              object={object}
              objects={objects}
              cardFields={cardFields}
              overlay
            />
          )}
        </DragOverlay>
      </DndContext>
      {records.hasNextPage && pages >= MAX_PAGES && (
        <p className="px-4 pb-3 text-xs text-muted">
          Showing the first {all.length} records. Add a filter to narrow the board.
        </p>
      )}
    </div>
  );
}
