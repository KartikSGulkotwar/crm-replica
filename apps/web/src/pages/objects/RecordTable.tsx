import type {
  FieldMetadataDto,
  ObjectMetadataDto,
  RecordDto,
  ViewDto,
  ViewFieldDto,
} from '@crm-replica/shared';
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
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ColumnDef,
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  Header,
  RowSelectionState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpRight, GripVertical } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EditableField } from '../../components/fields/Field';
import { Button, Spinner } from '../../components/ui';
import { useDeleteRecords, useUpdateRecord } from '../../lib/records';
import { useToast } from '../../lib/toast';

const SELECT_COLUMN = '__select';

function defaultWidth(field: FieldMetadataDto, isTitle: boolean) {
  if (isTitle) return 220;
  switch (field.type) {
    case 'BOOLEAN':
      return 100;
    case 'RATING':
    case 'NUMBER':
    case 'DATE':
      return 140;
    case 'MULTI_SELECT':
    case 'LINK':
    case 'EMAIL':
      return 200;
    default:
      return 170;
  }
}

function SortableHeader({ header }: { header: Header<RecordDto, unknown> }) {
  const sortable = useSortable({
    id: header.column.id,
    disabled: header.column.id === SELECT_COLUMN,
  });
  const style = {
    width: header.getSize(),
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 2 : undefined,
  };
  const isSelect = header.column.id === SELECT_COLUMN;
  return (
    <th
      ref={sortable.setNodeRef}
      style={style}
      className={`group relative border-b border-r border-line bg-surface px-2 py-2 text-left text-xs font-medium text-muted ${
        sortable.isDragging ? 'opacity-80 shadow' : ''
      }`}
    >
      <div className="flex items-center gap-1">
        {!isSelect && (
          <button
            type="button"
            aria-label={`Move column ${String(header.column.columnDef.header)}`}
            className="-ml-1 cursor-grab rounded p-0.5 text-muted/50 opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical aria-hidden className="size-3.5" />
          </button>
        )}
        <span className="truncate">
          {flexRender(header.column.columnDef.header, header.getContext())}
        </span>
      </div>
      {header.column.getCanResize() && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${String(header.column.columnDef.header)}`}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => header.column.resetSize()}
          className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-accent/40 ${
            header.column.getIsResizing() ? 'bg-accent' : ''
          }`}
        />
      )}
    </th>
  );
}

export function RecordTable({
  object,
  objects,
  view,
  onSaveFields,
  records,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  /** Column order, visibility and widths come from the view; changes are saved back to it. */
  view: ViewDto;
  onSaveFields: (fields: ViewFieldDto[]) => void;
  records: RecordDto[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const toast = useToast();
  const update = useUpdateRecord(object.namePlural);
  const remove = useDeleteRecords(object.namePlural);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const readOnly = object.isSystem;
  const titleName = object.labelIdentifierFieldName;

  // Visible fields in view order; the record title is always shown.
  const fields = useMemo(
    () =>
      view.fields
        .filter((vf) => vf.isVisible || vf.fieldName === titleName)
        .map((vf) => object.fields.find((f) => f.name === vf.fieldName))
        .filter((f): f is FieldMetadataDto => Boolean(f)),
    [view.fields, object.fields, titleName],
  );
  const viewWidths = useMemo(
    () =>
      Object.fromEntries(
        view.fields.filter((f) => f.width).map((f) => [f.fieldName, f.width!]),
      ) as ColumnSizingState,
    [view.fields],
  );
  const [sizing, setSizing] = useState<ColumnSizingState>(viewWidths);
  useEffect(() => setSizing(viewWidths), [viewWidths]);

  const columns = useMemo<ColumnDef<RecordDto>[]>(() => {
    const save =
      (record: RecordDto) =>
      (values: Record<string, unknown>, optimistic?: Record<string, unknown>) =>
        update.mutate(
          { id: record.id, values, optimistic },
          { onError: (error) => toast(`Couldn’t save: ${(error as Error).message}`, 'error') },
        );
    return [
      {
        id: SELECT_COLUMN,
        size: 40,
        enableResizing: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all loaded rows"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="size-4"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select row ${row.index + 1}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="size-4"
          />
        ),
      },
      ...fields.map<ColumnDef<RecordDto>>((field) => ({
        id: field.name,
        header: field.label,
        size: defaultWidth(field, field.name === titleName),
        minSize: 80,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <EditableField
                field={field}
                record={row.original}
                objects={objects}
                onSave={save(row.original)}
                readOnly={readOnly}
              />
            </div>
            {field.name === titleName && (
              <Link
                to={`/objects/${object.namePlural}/${row.original.id}`}
                aria-label={`Open ${object.labelSingular.toLowerCase()}`}
                className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-raised hover:text-ink group-hover/row:opacity-100 focus:opacity-100"
              >
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            )}
          </div>
        ),
      })),
    ];
    // `update`/`toast` are stable enough for cell renderers; recreating columns resets resizing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, objects, object.namePlural, object.labelSingular, titleName, readOnly]);

  const columnOrder = [SELECT_COLUMN, ...fields.map((f) => f.name)];

  /** Writes order/widths back into the view's full field list (hidden fields keep their place at the end). */
  function saveFields(order: string[], widths: ColumnSizingState) {
    const visible = order.filter((id) => id !== SELECT_COLUMN);
    const byName = new Map(view.fields.map((f) => [f.fieldName, f]));
    const hidden = view.fields.filter((f) => !visible.includes(f.fieldName));
    onSaveFields(
      [
        ...visible.map((name) => byName.get(name)).filter((f): f is ViewFieldDto => Boolean(f)),
        ...hidden,
      ].map((f, position) => ({
        ...f,
        width: widths[f.fieldName] ? Math.round(widths[f.fieldName]) : f.width,
        position,
      })),
    );
  }

  const table = useReactTable({
    data: records,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    enableRowSelection: !readOnly,
    state: { rowSelection, columnOrder, columnSizing: sizing },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setSizing,
  });

  // Save a column width once the user lets go of the resize handle.
  const resizing = table.getState().columnSizingInfo.isResizingColumn;
  const wasResizing = useRef<string | false>(false);
  useEffect(() => {
    if (wasResizing.current && !resizing) saveFields(columnOrder, sizing);
    wasResizing.current = resizing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id || e.over.id === SELECT_COLUMN) return;
    saveFields(
      arrayMove(
        columnOrder,
        columnOrder.indexOf(String(e.active.id)),
        columnOrder.indexOf(String(e.over.id)),
      ),
      sizing,
    );
  }

  // Infinite scroll: load the next page when the sentinel below the last row becomes visible.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const noun = (n: number) =>
    n === 1 ? object.labelSingular.toLowerCase() : object.labelPlural.toLowerCase();
  function deleteSelected() {
    const n = selectedIds.length;
    if (!confirm(`Delete ${n} ${noun(n)}?`)) return;
    remove.mutate(selectedIds, {
      onSuccess: ({ deletedIds }) => {
        setRowSelection({});
        toast(`Deleted ${deletedIds.length} ${noun(deletedIds.length)}`);
      },
      onError: (error) => toast(`Couldn’t delete: ${(error as Error).message}`, 'error'),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm">
          <span>
            <strong>{selectedIds.length}</strong> selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setRowSelection({})}>
              Clear
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={deleteSelected}>
              Delete selected
            </Button>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <table
            className="table-fixed border-separate border-spacing-0 text-sm"
            style={{ width: table.getTotalSize() }}
          >
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                    {group.headers.map((header) => (
                      <SortableHeader key={header.id} header={header} />
                    ))}
                  </SortableContext>
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`group/row ${row.getIsSelected() ? 'bg-accent-soft' : 'bg-surface hover:bg-raised'}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="truncate border-b border-r border-line px-2 py-1 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DndContext>
        <div ref={sentinel} className="flex justify-center px-4 py-3">
          {isFetchingNextPage ? (
            <Spinner />
          ) : hasNextPage ? (
            <Button variant="secondary" onClick={fetchNextPage}>
              Load more
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
