import type { OptionColor, SelectOption } from '@crm-replica/shared';
import { labelToOptionValue, OPTION_COLORS } from '@crm-replica/shared';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Popover } from '../../../components/Popover';

/** An option being edited. `value` is set for options that already exist (their identity). */
export interface DraftOption {
  key: string;
  label: string;
  color: OptionColor;
  value?: string;
}

const SWATCH: Record<OptionColor, string> = {
  gray: 'bg-gray-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

let nextKey = 1;
export const draftFromOptions = (options: SelectOption[] | null): DraftOption[] =>
  (options ?? []).map((o) => ({
    key: `k${nextKey++}`,
    label: o.label,
    color: o.color,
    value: o.value,
  }));

/** The value an option will be stored as (existing value, or derived from its label). */
export const optionValue = (o: DraftOption) => o.value ?? labelToOptionValue(o.label);

function ColorButton({
  color,
  onChange,
  label,
}: {
  color: OptionColor;
  onChange: (c: OptionColor) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`Color for ${label || 'option'}: ${color}`}
        onClick={() => setOpen(true)}
        className={`size-5 shrink-0 rounded-full ring-offset-2 hover:ring-2 hover:ring-line ${SWATCH[color]}`}
      />
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={190}>
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5 p-1.5">
            {OPTION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={`size-6 rounded-full ${SWATCH[c]} ${c === color ? 'ring-2 ring-accent ring-offset-2' : ''}`}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Add, rename, recolor, reorder and remove select options. */
export function OptionsEditor({
  options,
  onChange,
  savedValues = [],
}: {
  options: DraftOption[];
  onChange: (o: DraftOption[]) => void;
  savedValues?: string[];
}) {
  const [newLabel, setNewLabel] = useState('');
  const set = (i: number, patch: Partial<DraftOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, by: number) => {
    const next = [...options];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const removed = savedValues.filter((v) => !options.some((o) => o.value === v));

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    onChange([
      ...options,
      {
        key: `k${nextKey++}`,
        label,
        color: OPTION_COLORS[(options.length + 1) % OPTION_COLORS.length],
      },
    ]);
    setNewLabel('');
  }

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5" aria-label="Options">
        {options.map((o, i) => (
          <li key={o.key} className="flex items-center gap-2">
            <ColorButton color={o.color} label={o.label} onChange={(color) => set(i, { color })} />
            <input
              aria-label={`Option ${i + 1}`}
              value={o.label}
              onChange={(e) => set(i, { label: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <button
              type="button"
              aria-label={`Move ${o.label} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="rounded p-1 text-muted hover:bg-raised disabled:opacity-30"
            >
              <ArrowUp aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Move ${o.label} down`}
              disabled={i === options.length - 1}
              onClick={() => move(i, 1)}
              className="rounded p-1 text-muted hover:bg-raised disabled:opacity-30"
            >
              <ArrowDown aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${o.label}`}
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="rounded p-1 text-muted hover:bg-raised hover:text-bad"
            >
              <X aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          aria-label="New option"
          placeholder="Add an option…"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-dashed border-line bg-surface px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded-md px-2 text-sm text-accent hover:bg-raised"
        >
          <Plus aria-hidden className="size-4" /> Add
        </button>
      </div>
      {removed.length > 0 && (
        <p role="alert" className="rounded-md bg-warn/10 px-2 py-1.5 text-xs text-warn">
          Records that use a removed option will have it cleared when you save.
        </p>
      )}
    </div>
  );
}
