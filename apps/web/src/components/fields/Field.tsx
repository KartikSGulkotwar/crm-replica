import type {
  CurrencyValue,
  FieldMetadataDto,
  ObjectMetadataDto,
  RecordDto,
  SelectOption,
} from '@crm-replica/shared';
import { FieldType } from '@crm-replica/shared';
import { Check, Star } from 'lucide-react';
import { KeyboardEvent, ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  fromDateTimeLocal,
  linkHref,
  linkLabel,
  optionFor,
  toDateTimeLocal,
} from '../../lib/format';
import { findObjectByName } from '../../lib/metadata';
import { recordLabel } from '../../lib/record-label';
import { fieldKey } from '../../lib/records';
import { Popover } from '../Popover';
import { OPTION_COLOR_CLASSES } from './option-colors';
import { RelationPicker } from './RelationPicker';

export interface FieldProps {
  field: FieldMetadataDto;
  record: RecordDto;
  objects: ObjectMetadataDto[];
}

/** Saves `values` (API payload); `optimistic` is extra display-only data for the cache. */
export type SaveFn = (
  values: Record<string, unknown>,
  optimistic?: Record<string, unknown>,
) => void;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'SGD'];

export function OptionChip({ option }: { option: SelectOption }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-md px-1.5 py-0.5 text-xs font-medium ${OPTION_COLOR_CLASSES[option.color]}`}
    >
      {option.label}
    </span>
  );
}

function Stars({
  value,
  max,
  onSet,
  label,
}: {
  value: number | null;
  max: number;
  onSet?: (n: number | null) => void;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center"
      role={onSet ? 'radiogroup' : undefined}
      aria-label={label}
    >
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const filled = value !== null && n <= value;
        const icon = (
          <Star
            aria-hidden
            className={`size-4 ${filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted/40'}`}
          />
        );
        return onSet ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of ${max}`}
            onClick={(e) => {
              e.stopPropagation();
              onSet(value === n ? null : n);
            }}
            className="rounded p-0.5 hover:bg-raised"
          >
            {icon}
          </button>
        ) : (
          <span key={n} className="p-0.5">
            {icon}
          </span>
        );
      })}
    </span>
  );
}

/** Read-only rendering of a field's value. */
export function FieldDisplay({ field, record, objects }: FieldProps) {
  const value = record[fieldKey(field)];
  const empty = <span className="text-muted/60">—</span>;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  switch (field.type) {
    case FieldType.BOOLEAN:
      return value ? (
        <Check aria-label="Yes" className="size-4 text-accent" />
      ) : (
        <span className="sr-only">No</span>
      );
    case FieldType.NUMBER:
      return typeof value === 'number' ? (
        <span className="tabular-nums">{formatNumber(value)}</span>
      ) : (
        empty
      );
    case FieldType.CURRENCY: {
      const text = formatCurrency(value as CurrencyValue | null);
      return text ? <span className="tabular-nums">{text}</span> : empty;
    }
    case FieldType.DATE:
      return typeof value === 'string' ? <span>{formatDate(value)}</span> : empty;
    case FieldType.DATE_TIME:
      return typeof value === 'string' ? <span>{formatDateTime(value)}</span> : empty;
    case FieldType.SELECT: {
      const option = optionFor(field, value);
      return option ? <OptionChip option={option} /> : empty;
    }
    case FieldType.MULTI_SELECT: {
      const options = ((value as string[]) ?? [])
        .map((v) => optionFor(field, v))
        .filter(Boolean) as SelectOption[];
      return options.length ? (
        <span className="flex flex-wrap gap-1">
          {options.map((o) => (
            <OptionChip key={o.value} option={o} />
          ))}
        </span>
      ) : (
        empty
      );
    }
    case FieldType.RATING:
      return (
        <Stars
          value={(value as number) ?? null}
          max={field.settings?.max ?? 5}
          label={field.label}
        />
      );
    case FieldType.EMAIL:
      return typeof value === 'string' && value ? (
        <a href={`mailto:${value}`} onClick={stop} className="truncate text-accent hover:underline">
          {value}
        </a>
      ) : (
        empty
      );
    case FieldType.PHONE:
      return typeof value === 'string' && value ? (
        <a
          href={`tel:${value.replace(/\s/g, '')}`}
          onClick={stop}
          className="truncate hover:underline"
        >
          {value}
        </a>
      ) : (
        empty
      );
    case FieldType.LINK:
      return typeof value === 'string' && value ? (
        <a
          href={linkHref(value)}
          target="_blank"
          rel="noreferrer noopener"
          onClick={stop}
          className="truncate text-accent hover:underline"
        >
          {linkLabel(value)}
        </a>
      ) : (
        empty
      );
    case FieldType.RELATION: {
      if (typeof value !== 'string') return empty;
      const target = findObjectByName(objects, field.relation?.targetObjectName);
      const linked = record[field.name] as RecordDto | null | undefined;
      return (
        <Link
          to={`/objects/${target?.namePlural}/${value}`}
          onClick={stop}
          className="inline-flex max-w-full items-center truncate rounded-md bg-raised px-1.5 py-0.5 text-xs font-medium hover:bg-accent-soft hover:text-accent"
        >
          {linked
            ? recordLabel(target, linked)
            : linked === null
              ? 'Deleted record'
              : 'Linked record'}
        </Link>
      );
    }
    default:
      return typeof value === 'string' && value ? <span className="truncate">{value}</span> : empty;
  }
}

/** Text-like editor: commits on Enter or blur, cancels on Escape. */
function InputEditor({
  initial,
  type,
  onCommit,
  onCancel,
  parse,
  label,
}: {
  initial: string;
  type: string;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  parse: (raw: string) => { ok: true; value: unknown } | { ok: false };
  label: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  function commit() {
    if (done.current) return;
    if (draft === initial) {
      done.current = true;
      return onCancel();
    }
    const parsed = parse(draft);
    if (!parsed.ok) return setInvalid(true);
    done.current = true;
    onCommit(parsed.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      onCancel();
    }
  }

  return (
    <input
      autoFocus
      type={type}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft}
      step={type === 'number' ? 'any' : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className={`w-full min-w-0 rounded-md border bg-surface px-2 py-1 text-sm outline-none ring-2 ${
        invalid ? 'border-bad ring-bad/20' : 'border-accent ring-accent/20'
      }`}
    />
  );
}

function CurrencyEditor({
  value,
  defaultCurrency,
  onCommit,
  onCancel,
  label,
}: {
  value: CurrencyValue | null;
  defaultCurrency: string;
  onCommit: (v: CurrencyValue | null) => void;
  onCancel: () => void;
  label: string;
}) {
  const [amount, setAmount] = useState(value?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState(value?.currency ?? defaultCurrency);
  const box = useRef<HTMLDivElement>(null);

  function commit() {
    if (amount.trim() === '') return onCommit(null);
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    if (n === value?.amount && currency === value?.currency) return onCancel();
    onCommit({ amount: n, currency });
  }

  return (
    <div
      ref={box}
      className="flex w-full gap-1"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <input
        autoFocus
        type="number"
        step="any"
        aria-label={`${label} amount`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full min-w-0 rounded-md border border-accent bg-surface px-2 py-1 text-sm outline-none ring-2 ring-accent/20"
      />
      <select
        aria-label={`${label} currency`}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="rounded-md border border-line bg-surface px-1 text-xs"
      >
        {[...new Set([currency, ...CURRENCIES])].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}

function OptionsMenu({
  anchor,
  field,
  selected,
  multi,
  onChange,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  field: FieldMetadataDto;
  selected: string[];
  multi: boolean;
  onChange: (values: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <ul
        role="listbox"
        aria-label={field.label}
        aria-multiselectable={multi || undefined}
        className="max-h-64 overflow-y-auto py-1"
      >
        {!multi && (
          <li>
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded px-2 py-1.5 text-left text-muted hover:bg-raised"
            >
              No {field.label.toLowerCase()}
            </button>
          </li>
        )}
        {(field.options ?? []).map((o) => {
          const isSelected = selected.includes(o.value);
          return (
            <li key={o.value} role="option" aria-selected={isSelected}>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    multi
                      ? isSelected
                        ? selected.filter((v) => v !== o.value)
                        : [...selected, o.value]
                      : [o.value],
                  )
                }
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-raised"
              >
                <OptionChip option={o} />
                {isSelected && <Check aria-hidden className="size-4 text-accent" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

const parsers = {
  text: (raw: string) => ({ ok: true as const, value: raw === '' ? null : raw }),
  number: (raw: string) => {
    if (raw.trim() === '') return { ok: true as const, value: null };
    const n = Number(raw);
    return Number.isFinite(n) ? { ok: true as const, value: n } : { ok: false as const };
  },
  date: (raw: string) => ({ ok: true as const, value: raw || null }),
  dateTime: (raw: string) => ({ ok: true as const, value: fromDateTimeLocal(raw) }),
};

/**
 * A field value you can edit in place: click (or press Enter) to edit. Checkboxes and ratings
 * change with one click. Used in table cells and on the record page.
 */
export function EditableField({
  field,
  record,
  objects,
  onSave,
  readOnly,
}: FieldProps & { onSave: SaveFn; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const key = fieldKey(field);
  const value = record[key];
  const save = (v: unknown, optimistic?: Record<string, unknown>) => {
    setEditing(false);
    onSave({ [key]: v }, optimistic);
  };
  const stopEditing = () => setEditing(false);

  if (readOnly) {
    return (
      <div className="flex min-h-7 min-w-0 items-center">
        <FieldDisplay field={field} record={record} objects={objects} />
      </div>
    );
  }

  if (field.type === FieldType.BOOLEAN) {
    return (
      <label
        className="flex min-h-7 cursor-pointer items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={field.label}
          checked={Boolean(value)}
          onChange={(e) => onSave({ [key]: e.target.checked })}
          className="size-4 accent-[var(--color-accent)]"
        />
      </label>
    );
  }

  if (field.type === FieldType.RATING) {
    return (
      <div className="flex min-h-7 items-center">
        <Stars
          value={(value as number) ?? null}
          max={field.settings?.max ?? 5}
          onSet={(n) => onSave({ [key]: n })}
          label={field.label}
        />
      </div>
    );
  }

  let editor: ReactNode = null;
  if (editing) {
    switch (field.type) {
      case FieldType.NUMBER:
        editor = (
          <InputEditor
            type="number"
            label={field.label}
            initial={value == null ? '' : String(value)}
            parse={parsers.number}
            onCommit={save}
            onCancel={stopEditing}
          />
        );
        break;
      case FieldType.CURRENCY:
        editor = (
          <CurrencyEditor
            label={field.label}
            value={value as CurrencyValue | null}
            defaultCurrency={field.settings?.currency ?? 'USD'}
            onCommit={save}
            onCancel={stopEditing}
          />
        );
        break;
      case FieldType.DATE:
        editor = (
          <InputEditor
            type="date"
            label={field.label}
            initial={(value as string) ?? ''}
            parse={parsers.date}
            onCommit={save}
            onCancel={stopEditing}
          />
        );
        break;
      case FieldType.DATE_TIME:
        editor = (
          <InputEditor
            type="datetime-local"
            label={field.label}
            initial={toDateTimeLocal(value as string)}
            parse={parsers.dateTime}
            onCommit={save}
            onCancel={stopEditing}
          />
        );
        break;
      case FieldType.SELECT:
      case FieldType.MULTI_SELECT:
      case FieldType.RELATION:
        break; // popover editors below
      default: {
        const type =
          field.type === FieldType.EMAIL
            ? 'email'
            : field.type === FieldType.PHONE
              ? 'tel'
              : field.type === FieldType.LINK
                ? 'url'
                : 'text';
        editor = (
          <InputEditor
            type={type}
            label={field.label}
            initial={(value as string) ?? ''}
            parse={parsers.text}
            onCommit={save}
            onCancel={stopEditing}
          />
        );
      }
    }
  }

  const multi = field.type === FieldType.MULTI_SELECT;
  return (
    <>
      {editor ?? (
        <div
          ref={anchor}
          role="button"
          tabIndex={0}
          aria-label={`Edit ${field.label}`}
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget) {
              e.preventDefault();
              setEditing(true);
            }
          }}
          className="flex min-h-7 min-w-0 cursor-text items-center rounded-md px-1 -mx-1 outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <FieldDisplay field={field} record={record} objects={objects} />
        </div>
      )}
      {editing && (field.type === FieldType.SELECT || multi) && (
        <OptionsMenu
          anchor={anchor}
          field={field}
          multi={multi}
          selected={multi ? ((value as string[]) ?? []) : value ? [value as string] : []}
          onChange={(values) => (multi ? onSave({ [key]: values }) : save(values[0] ?? null))}
          onClose={stopEditing}
        />
      )}
      {editing && field.type === FieldType.RELATION && (
        <RelationPicker
          anchor={anchor}
          field={field}
          objects={objects}
          currentId={(value as string) ?? null}
          onPick={(picked) => save(picked?.id ?? null, { [field.name]: picked })}
          onClose={stopEditing}
        />
      )}
    </>
  );
}
