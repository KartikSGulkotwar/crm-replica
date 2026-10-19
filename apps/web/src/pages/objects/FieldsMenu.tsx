import type { ObjectMetadataDto, ViewFieldDto } from '@crm-replica/shared';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

function Row({
  field,
  label,
  locked,
  onToggle,
}: {
  field: ViewFieldDto;
  label: string;
  locked: boolean;
  onToggle: () => void;
}) {
  const sortable = useSortable({ id: field.fieldName });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`flex items-center gap-2 rounded px-1 py-1 ${sortable.isDragging ? 'bg-raised shadow' : 'hover:bg-raised'}`}
    >
      <button
        type="button"
        aria-label={`Move ${label}`}
        className="cursor-grab rounded p-0.5 text-muted"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      <label className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        <input
          type="checkbox"
          aria-label={`Show ${label}`}
          checked={field.isVisible || locked}
          disabled={locked}
          onChange={onToggle}
        />
      </label>
    </li>
  );
}

/** Show, hide and reorder a view's fields. The record title always stays visible. */
export function FieldsMenu({
  object,
  fields,
  onChange,
}: {
  object: ObjectMetadataDto;
  fields: ViewFieldDto[];
  onChange: (f: ViewFieldDto[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (name: string) => object.fields.find((f) => f.name === name)?.label ?? name;
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = fields.findIndex((f) => f.fieldName === e.active.id);
    const to = fields.findIndex((f) => f.fieldName === e.over!.id);
    onChange(arrayMove(fields, from, to));
  }
  return (
    <div className="p-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={fields.map((f) => f.fieldName)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="max-h-80 overflow-y-auto">
            {fields.map((f) => (
              <Row
                key={f.fieldName}
                field={f}
                label={label(f.fieldName)}
                locked={f.fieldName === object.labelIdentifierFieldName}
                onToggle={() =>
                  onChange(
                    fields.map((x) =>
                      x.fieldName === f.fieldName ? { ...x, isVisible: !x.isVisible } : x,
                    ),
                  )
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
