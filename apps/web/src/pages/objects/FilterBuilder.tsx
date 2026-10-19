import type {
  FieldMetadataDto,
  FilterOperator,
  ObjectMetadataDto,
  RecordDto,
  ViewDto,
  ViewFilterDto,
} from '@crm-replica/shared';
import { FIELD_TYPE_INFO, FieldType } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { OptionChip } from '../../components/fields/Field';
import { RelationPicker } from '../../components/fields/RelationPicker';
import { api } from '../../lib/api';
import { findObjectByName } from '../../lib/metadata';
import { recordLabel } from '../../lib/record-label';

/** Built-in fields you can filter on, shaped like metadata fields. */
export function filterableFields(object: ObjectMetadataDto): FieldMetadataDto[] {
  const system = (name: string, label: string): FieldMetadataDto => ({
    id: `system-${name}`,
    objectId: object.id,
    name,
    label,
    type: FieldType.DATE_TIME,
    description: null,
    isCustom: false,
    isRequired: false,
    defaultValue: null,
    options: null,
    settings: null,
    relation: null,
    position: 1000,
    managedByApp: null,
    deletedAt: null,
  });
  return [...object.fields, system('createdAt', 'Created at'), system('updatedAt', 'Updated at')];
}

const DATE_TYPES: string[] = [FieldType.DATE, FieldType.DATE_TIME];

export function operatorLabel(op: FilterOperator, type: FieldType): string {
  const isDate = DATE_TYPES.includes(type);
  const labels: Record<FilterOperator, string> = {
    eq: 'is',
    neq: 'is not',
    contains: 'contains',
    notContains: 'doesn’t contain',
    startsWith: 'starts with',
    gt: isDate ? 'is after' : 'greater than',
    gte: isDate ? 'is on or after' : 'at least',
    lt: isDate ? 'is before' : 'less than',
    lte: isDate ? 'is on or before' : 'at most',
    in: 'is any of',
    notIn: 'is none of',
    containsAny: 'has any of',
    containsAll: 'has all of',
    isEmpty: 'is empty',
    isNotEmpty: 'is not empty',
  };
  return labels[op];
}

const NO_VALUE: FilterOperator[] = ['isEmpty', 'isNotEmpty'];
const LIST_OPS: FilterOperator[] = ['in', 'notIn', 'containsAny', 'containsAll'];

/** Relation filters only offer what the picker can express. */
function operatorsFor(field: FieldMetadataDto): FilterOperator[] {
  const ops = FIELD_TYPE_INFO[field.type].operators;
  return field.type === FieldType.RELATION
    ? ops.filter((o) => ['eq', 'neq', 'isEmpty', 'isNotEmpty'].includes(o))
    : ops;
}

function defaultValue(field: FieldMetadataDto, op: FilterOperator): unknown {
  if (NO_VALUE.includes(op)) return undefined;
  if (LIST_OPS.includes(op)) return [];
  if (field.type === FieldType.BOOLEAN) return true;
  return undefined;
}

/** Whether a filter is ready to apply (has the value its operator needs). */
export function isComplete(filter: ViewFilterDto): boolean {
  if (NO_VALUE.includes(filter.operator as FilterOperator)) return true;
  if (Array.isArray(filter.value)) return filter.value.length > 0;
  return filter.value !== undefined && filter.value !== null && filter.value !== '';
}

const inputClass = 'min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-sm';

function RelationValue({
  field,
  objects,
  value,
  onChange,
}: {
  field: FieldMetadataDto;
  objects: ObjectMetadataDto[];
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const target = findObjectByName(objects, field.relation?.targetObjectName);
  const linked = useQuery({
    queryKey: ['records', target?.namePlural, 'one', value],
    queryFn: () => api<RecordDto>(`/objects/${target!.namePlural}/${value}`),
    enabled: typeof value === 'string' && Boolean(target),
  });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        className={`${inputClass} min-w-32 text-left`}
      >
        {typeof value === 'string' ? (
          linked.data ? (
            recordLabel(target, linked.data)
          ) : (
            '…'
          )
        ) : (
          <span className="text-muted">Choose…</span>
        )}
      </button>
      {open && (
        <RelationPicker
          anchor={anchor}
          field={field}
          objects={objects}
          currentId={typeof value === 'string' ? value : null}
          onPick={(r) => {
            onChange(r?.id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The value input that fits a field type and operator. Text-like inputs report on blur/Enter. */
function ValueInput({
  field,
  operator,
  value,
  objects,
  onChange,
}: {
  field: FieldMetadataDto;
  operator: FilterOperator;
  value: unknown;
  objects: ObjectMetadataDto[];
  onChange: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  if (NO_VALUE.includes(operator)) return null;

  if (LIST_OPS.includes(operator)) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1" role="group" aria-label={`${field.label} values`}>
        {(field.options ?? []).map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 py-0.5"
          >
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value),
                )
              }
            />
            <OptionChip option={o} />
          </label>
        ))}
      </div>
    );
  }

  switch (field.type) {
    case FieldType.SELECT:
      return (
        <select
          aria-label={`${field.label} value`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case FieldType.BOOLEAN:
      return (
        <select
          aria-label={`${field.label} value`}
          value={String(value ?? true)}
          onChange={(e) => onChange(e.target.value === 'true')}
          className={inputClass}
        >
          <option value="true">checked</option>
          <option value="false">not checked</option>
        </select>
      );
    case FieldType.RELATION:
      return <RelationValue field={field} objects={objects} value={value} onChange={onChange} />;
    case FieldType.DATE:
    case FieldType.DATE_TIME:
      // Date-times are compared by day; the API accepts a plain date for both.
      return (
        <input
          type="date"
          aria-label={`${field.label} value`}
          value={(value as string)?.slice(0, 10) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      );
    default: {
      const numeric = (
        [FieldType.NUMBER, FieldType.CURRENCY, FieldType.RATING] as string[]
      ).includes(field.type);
      const commit = () => onChange(draft === '' ? undefined : numeric ? Number(draft) : draft);
      return (
        <input
          type={numeric ? 'number' : 'text'}
          step="any"
          aria-label={`${field.label} value`}
          placeholder="Value"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className={`${inputClass} w-36`}
        />
      );
    }
  }
}

/**
 * Edits a view's filters. Rows can be half-filled while you type; only complete filters are
 * applied and saved.
 */
export function FilterBuilder({
  object,
  objects,
  view,
  onChange,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  view: ViewDto;
  onChange: (filters: ViewFilterDto[], conjunction: 'and' | 'or') => void;
}) {
  const fields = filterableFields(object);
  const [rows, setRows] = useState<ViewFilterDto[]>(view.filters);
  const [conjunction, setConjunction] = useState(view.filterConjunction);

  function update(next: ViewFilterDto[], nextConjunction = conjunction) {
    setRows(next);
    setConjunction(nextConjunction);
    onChange(next.filter(isComplete), nextConjunction);
  }

  function addRow() {
    const field = fields[0];
    const operator = operatorsFor(field)[0];
    update([...rows, { fieldName: field.name, operator, value: defaultValue(field, operator) }]);
  }

  return (
    <div className="space-y-2 p-2">
      {rows.length === 0 && (
        <p className="px-1 text-sm text-muted">No filters. Every record is shown.</p>
      )}
      {rows.map((row, i) => {
        const field = fields.find((f) => f.name === row.fieldName) ?? fields[0];
        const set = (patch: Partial<ViewFilterDto>) =>
          update(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5" data-testid="filter-row">
            <span className="w-12 shrink-0 text-xs text-muted">
              {i === 0 ? (
                'Where'
              ) : i === 1 ? (
                <select
                  aria-label="Combine filters"
                  value={conjunction}
                  onChange={(e) => update(rows, e.target.value as 'and' | 'or')}
                  className="rounded border border-line bg-surface text-xs"
                >
                  <option value="and">and</option>
                  <option value="or">or</option>
                </select>
              ) : (
                conjunction
              )}
            </span>
            <select
              aria-label="Filter field"
              value={field.name}
              onChange={(e) => {
                const f = fields.find((x) => x.name === e.target.value)!;
                const op = operatorsFor(f)[0];
                set({ fieldName: f.name, operator: op, value: defaultValue(f, op) });
              }}
              className={inputClass}
            >
              {fields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter operator"
              value={row.operator}
              onChange={(e) => {
                const op = e.target.value as FilterOperator;
                const keep =
                  !NO_VALUE.includes(op) && LIST_OPS.includes(op) === Array.isArray(row.value);
                set({ operator: op, value: keep ? row.value : defaultValue(field, op) });
              }}
              className={inputClass}
            >
              {operatorsFor(field).map((op) => (
                <option key={op} value={op}>
                  {operatorLabel(op, field.type)}
                </option>
              ))}
            </select>
            <ValueInput
              field={field}
              operator={row.operator as FilterOperator}
              value={row.value}
              objects={objects}
              onChange={(value) => set({ value })}
            />
            <button
              type="button"
              aria-label="Remove filter"
              onClick={() => update(rows.filter((_, j) => j !== i))}
              className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1 rounded px-1 py-1 text-sm text-accent hover:bg-raised"
      >
        <Plus aria-hidden className="size-4" />
        Add filter
      </button>
    </div>
  );
}
