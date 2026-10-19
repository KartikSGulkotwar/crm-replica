import type { ObjectMetadataDto, ViewSortDto } from '@crm-replica/shared';
import { FieldType } from '@crm-replica/shared';
import { Plus, X } from 'lucide-react';
import { filterableFields } from './FilterBuilder';

const UNSORTABLE: string[] = [FieldType.MULTI_SELECT, FieldType.RELATION];
const inputClass = 'min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-sm';

/** Edits a view's sorts (most important first, up to 5). */
export function SortBuilder({
  object,
  sorts,
  onChange,
}: {
  object: ObjectMetadataDto;
  sorts: ViewSortDto[];
  onChange: (s: ViewSortDto[]) => void;
}) {
  const fields = filterableFields(object).filter((f) => !UNSORTABLE.includes(f.type));
  const unused = fields.filter((f) => !sorts.some((s) => s.fieldName === f.name));

  return (
    <div className="space-y-2 p-2">
      {sorts.length === 0 && (
        <p className="px-1 text-sm text-muted">Manual order. Add a sort to order by a field.</p>
      )}
      {sorts.map((sort, i) => (
        <div key={sort.fieldName} className="flex items-center gap-1.5" data-testid="sort-row">
          <span className="w-12 shrink-0 text-xs text-muted">{i === 0 ? 'Sort by' : 'then'}</span>
          <select
            aria-label="Sort field"
            value={sort.fieldName}
            onChange={(e) =>
              onChange(sorts.map((s, j) => (j === i ? { ...s, fieldName: e.target.value } : s)))
            }
            className={inputClass}
          >
            {fields
              .filter((f) => f.name === sort.fieldName || unused.includes(f))
              .map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
          </select>
          <select
            aria-label="Sort direction"
            value={sort.direction}
            onChange={(e) =>
              onChange(
                sorts.map((s, j) =>
                  j === i ? { ...s, direction: e.target.value as 'asc' | 'desc' } : s,
                ),
              )
            }
            className={inputClass}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button
            type="button"
            aria-label="Remove sort"
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      {sorts.length < 5 && unused.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...sorts, { fieldName: unused[0].name, direction: 'asc' }])}
          className="flex items-center gap-1 rounded px-1 py-1 text-sm text-accent hover:bg-raised"
        >
          <Plus aria-hidden className="size-4" />
          Add sort
        </button>
      )}
    </div>
  );
}
