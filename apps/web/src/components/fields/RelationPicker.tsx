import type { FieldMetadataDto, ObjectMetadataDto, RecordDto } from '@crm-replica/shared';
import { Check, Search } from 'lucide-react';
import { RefObject, useState } from 'react';
import { findObjectByName } from '../../lib/metadata';
import { recordLabel, searchFields } from '../../lib/record-label';
import { useRecordSearch } from '../../lib/records';
import { Popover } from '../Popover';
import { Spinner } from '../ui';

/** Searchable list of records of the relation's target object. */
export function RelationPicker({
  anchor,
  field,
  objects,
  currentId,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  field: FieldMetadataDto;
  objects: ObjectMetadataDto[];
  currentId: string | null;
  onPick: (record: RecordDto | null) => void;
  onClose: () => void;
}) {
  const target = findObjectByName(objects, field.relation?.targetObjectName);
  const [search, setSearch] = useState('');
  const term = search.trim();
  const fields = target ? searchFields(target) : [];
  const filter =
    term && fields.length
      ? { or: fields.map((f) => ({ field: f, op: 'contains', value: term })) }
      : undefined;
  const results = useRecordSearch(
    target?.namePlural,
    { filter, sort: fields[0] ? `${fields[0]}:asc` : undefined },
    Boolean(target),
  );

  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      <div className="flex items-center gap-2 border-b border-line px-2 pb-1.5 pt-1">
        <Search aria-hidden className="size-4 text-muted" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${target?.labelPlural.toLowerCase() ?? 'records'}…`}
          aria-label={`Search ${target?.labelPlural ?? 'records'}`}
          className="min-w-0 flex-1 bg-transparent py-1 outline-none"
        />
      </div>
      <ul role="listbox" aria-label={field.label} className="max-h-64 overflow-y-auto py-1">
        <li>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex w-full rounded px-2 py-1.5 text-left text-muted hover:bg-raised"
          >
            No {field.label.toLowerCase()}
          </button>
        </li>
        {results.isPending && (
          <li className="px-2 py-2 text-muted">
            <Spinner />
          </li>
        )}
        {results.isError && <li className="px-2 py-2 text-bad">Couldn’t load records</li>}
        {results.data?.data.map((r) => (
          <li key={r.id} role="option" aria-selected={r.id === currentId}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-raised"
            >
              <span className="truncate">{recordLabel(target, r)}</span>
              {r.id === currentId && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
            </button>
          </li>
        ))}
        {results.data && results.data.data.length === 0 && (
          <li className="px-2 py-2 text-muted">
            {term ? `No matches for “${term}”` : `No ${target?.labelPlural.toLowerCase()} yet`}
          </li>
        )}
      </ul>
    </Popover>
  );
}
