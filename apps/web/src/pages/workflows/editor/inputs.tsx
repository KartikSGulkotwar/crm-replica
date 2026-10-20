import type {
  ConditionGroup,
  ConditionOperator,
  FieldMetadataDto,
  ObjectMetadataDto,
} from '@crm-replica/shared';
import { CONDITION_OPERATORS, FieldType } from '@crm-replica/shared';
import { Braces, Plus, X } from 'lucide-react';
import { ReactNode, useId, useRef, useState } from 'react';
import { Popover } from '../../../components/Popover';
import type { VariableGroup } from './variables';

export const inputClass =
  'w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

/**
 * A captioned group. It's a named group, not a <label>: it often wraps several controls (each
 * with its own accessible name), and a <label> would rename every button inside it.
 */
export function Labeled({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="block text-sm">
      <span id={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

function VariablePicker({
  groups,
  onPick,
}: {
  groups: VariableGroup[];
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const term = search.toLowerCase();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Insert variable"
        title="Insert a variable"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border border-line px-1.5 text-muted hover:bg-raised hover:text-accent"
      >
        <Braces aria-hidden className="size-4" />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={300}>
          <input
            autoFocus
            aria-label="Search variables"
            placeholder="Search variables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} mb-1`}
          />
          <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Variables">
            {groups.map((g) => {
              const vars = g.variables.filter(
                (v) =>
                  !term ||
                  v.label.toLowerCase().includes(term) ||
                  v.path.toLowerCase().includes(term),
              );
              if (!vars.length) return null;
              return (
                <div key={g.label} className="py-1">
                  <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {g.label}
                  </div>
                  {vars.map((v) => (
                    <button
                      key={v.path}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        onPick(v.path);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-raised"
                    >
                      <span className="truncate">{v.label}</span>
                      <code className="truncate font-mono text-[10px] text-muted">{v.path}</code>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}

/** A text input (or textarea) where `{{variables}}` can be inserted at the cursor. */
export function TemplateInput({
  value,
  onChange,
  groups,
  label,
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: VariableGroup[];
  label: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const insert = (path: string) => {
    const el = ref.current;
    const token = `{{${path}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const props = {
    ref,
    'aria-label': label,
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    className: `${inputClass} font-mono text-[13px]`,
  };
  return (
    <div className="flex gap-1">
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
      <VariablePicker groups={groups} onPick={insert} />
    </div>
  );
}

export function ObjectSelect({
  value,
  onChange,
  objects,
  label = 'Object',
  allowNone,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  objects: ObjectMetadataDto[];
  label?: string;
  allowNone?: string;
}) {
  return (
    <Labeled label={label}>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={inputClass}
      >
        {allowNone ? (
          <option value="">{allowNone}</option>
        ) : (
          !value && <option value="">Choose…</option>
        )}
        {objects
          .filter((o) => !o.isSystem)
          .map((o) => (
            <option key={o.id} value={o.nameSingular}>
              {o.labelPlural}
            </option>
          ))}
      </select>
    </Labeled>
  );
}

const OP_LABELS: Record<ConditionOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  notContains: 'doesn’t contain',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

/** “{{trigger.record.stage}} is WON” rows, combined with all / any. */
export function ConditionsEditor({
  value,
  onChange,
  groups,
  emptyText,
}: {
  value: ConditionGroup;
  onChange: (v: ConditionGroup) => void;
  groups: VariableGroup[];
  emptyText: string;
}) {
  const set = (i: number, patch: Partial<ConditionGroup['conditions'][number]>) =>
    onChange({
      ...value,
      conditions: value.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  return (
    <div className="space-y-2">
      {value.conditions.length === 0 && <p className="text-xs text-muted">{emptyText}</p>}
      {value.conditions.length > 1 && (
        <select
          aria-label="Match"
          value={value.match}
          onChange={(e) => onChange({ ...value, match: e.target.value as 'all' | 'any' })}
          className={`${inputClass} w-auto`}
        >
          <option value="all">All of these are true</option>
          <option value="any">Any of these is true</option>
        </select>
      )}
      {value.conditions.map((c, i) => (
        <div
          key={i}
          className="grid gap-1.5 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto]"
          data-testid="condition"
        >
          <TemplateInput
            label={`Condition ${i + 1} value`}
            value={c.left}
            onChange={(left) => set(i, { left })}
            groups={groups}
            placeholder="{{trigger.record.stage}}"
          />
          <select
            aria-label={`Condition ${i + 1} operator`}
            value={c.op}
            onChange={(e) => set(i, { op: e.target.value as ConditionOperator })}
            className={inputClass}
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op]}
              </option>
            ))}
          </select>
          {c.op === 'isEmpty' || c.op === 'isNotEmpty' ? (
            <span />
          ) : (
            <TemplateInput
              label={`Condition ${i + 1} compare to`}
              value={c.right ?? ''}
              onChange={(right) => set(i, { right })}
              groups={groups}
              placeholder="WON"
            />
          )}
          <button
            type="button"
            aria-label={`Remove condition ${i + 1}`}
            onClick={() =>
              onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) })
            }
            className="self-center rounded p-1 text-muted hover:bg-raised hover:text-bad"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            conditions: [...value.conditions, { left: '', op: 'eq', right: '' }],
          })
        }
        className="flex items-center gap-1 text-sm text-accent hover:underline"
      >
        <Plus aria-hidden className="size-4" /> Add condition
      </button>
    </div>
  );
}

const fieldKey = (f: FieldMetadataDto) => (f.type === FieldType.RELATION ? `${f.name}Id` : f.name);
const hasVariable = (v: string) => /\{\{.*\}\}/.test(v);

/** Converts what was typed into the value the records API expects for the field. */
function toValue(field: FieldMetadataDto, text: string): unknown {
  if (hasVariable(text) && /^\{\{[^}]*\}\}$/.test(text.trim())) return text.trim(); // a lone variable keeps its type
  switch (field.type) {
    case FieldType.NUMBER:
    case FieldType.RATING:
      return text.trim() !== '' && !Number.isNaN(Number(text)) ? Number(text) : text;
    case FieldType.CURRENCY:
      return text.trim() !== '' && !Number.isNaN(Number(text)) ? { amount: Number(text) } : text;
    case FieldType.MULTI_SELECT:
      return hasVariable(text)
        ? text
        : text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    default:
      return text;
  }
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && 'amount' in (value as object))
    return String((value as { amount: unknown }).amount ?? '');
  return String(value);
}

/** Field → value rows for create/update record steps. */
export function ValuesEditor({
  object,
  value,
  onChange,
  groups,
}: {
  object: ObjectMetadataDto | undefined;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  groups: VariableGroup[];
}) {
  // Select fields switched to "Use a variable…" show a variable input instead of the options.
  const [variableKeys, setVariableKeys] = useState<string[]>([]);
  if (!object) return <p className="text-xs text-muted">Choose an object first.</p>;
  const fields = object.fields;
  const used = Object.keys(value);
  const unused = fields.filter((f) => !used.includes(fieldKey(f)));
  const setKey = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-2">
      {used.length === 0 && <p className="text-xs text-muted">No fields set yet.</p>}
      {used.map((key) => {
        const field = fields.find((f) => fieldKey(f) === key);
        const current = value[key];
        return (
          <div
            key={key}
            className="grid items-start gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
            data-testid="value-row"
          >
            <span className="truncate pt-1.5 text-sm">{field?.label ?? key}</span>
            {field?.type === FieldType.BOOLEAN ? (
              <select
                aria-label={field.label}
                value={String(current)}
                onChange={(e) => setKey(key, e.target.value === 'true')}
                className={inputClass}
              >
                <option value="true">Checked</option>
                <option value="false">Not checked</option>
              </select>
            ) : field?.type === FieldType.SELECT &&
              !hasVariable(toText(current)) &&
              !variableKeys.includes(key) ? (
              <select
                aria-label={field.label}
                value={toText(current)}
                onChange={(e) => {
                  if (e.target.value !== '__var') return setKey(key, e.target.value);
                  setVariableKeys((k) => [...k, key]);
                  setKey(key, '');
                }}
                className={inputClass}
              >
                <option value="">(empty)</option>
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value="__var">Use a variable…</option>
              </select>
            ) : (
              <TemplateInput
                label={field?.label ?? key}
                value={toText(current)}
                onChange={(text) => setKey(key, field ? toValue(field, text) : text)}
                groups={groups}
                placeholder={
                  field?.type === FieldType.RELATION
                    ? '{{steps.….result.id}}'
                    : field?.options
                      ? field.options.map((o) => o.value).join(', ')
                      : undefined
                }
              />
            )}
            <button
              type="button"
              aria-label={`Remove ${field?.label ?? key}`}
              onClick={() =>
                onChange(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)))
              }
              className="rounded p-1.5 text-muted hover:bg-raised hover:text-bad"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        );
      })}
      {unused.length > 0 && (
        <select
          aria-label="Add a field"
          value=""
          onChange={(e) => {
            const f = fields.find((x) => fieldKey(x) === e.target.value);
            if (f)
              setKey(
                fieldKey(f),
                f.type === FieldType.BOOLEAN
                  ? true
                  : f.type === FieldType.SELECT
                    ? (f.options?.[0]?.value ?? '')
                    : '',
              );
          }}
          className={`${inputClass} w-auto text-accent`}
        >
          <option value="">+ Set a field…</option>
          {unused.map((f) => (
            <option key={f.id} value={fieldKey(f)}>
              {f.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
