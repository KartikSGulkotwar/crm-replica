import type {
  CreateFieldInput,
  FieldMetadataDto,
  ObjectMetadataDto,
  UpdateFieldInput,
} from '@crm-replica/shared';
import {
  FIELD_TYPE_INFO,
  FIELD_TYPES,
  FieldType,
  labelToApiName,
  RelationOnDelete,
} from '@crm-replica/shared';
import { FormEvent, ReactNode, useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import { FieldTypeIcon } from '../../../components/FieldTypeIcon';
import { Button, FormError, TextField } from '../../../components/ui';
import { useCreateField, useUpdateField } from '../../../lib/metadata-mutations';
import { DraftOption, draftFromOptions, OptionsEditor, optionValue } from './OptionsEditor';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'SGD'];
const selectClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm';
const isSelect = (t: FieldType) => t === FieldType.SELECT || t === FieldType.MULTI_SELECT;

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{title}</div>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: FieldType | null;
  onChange: (t: FieldType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Field type"
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
    >
      {FIELD_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          onClick={() => onChange(type)}
          className={`flex items-start gap-2 rounded-lg border p-2 text-left ${value === type ? 'border-accent bg-accent-soft' : 'border-line hover:bg-raised'}`}
        >
          <FieldTypeIcon type={type} className="mt-0.5 size-4 shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{FIELD_TYPE_INFO[type].label}</span>
            <span className="block truncate text-xs text-muted">
              {FIELD_TYPE_INFO[type].description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Default-value input for the types that support one. `undefined` = no default. */
function DefaultValueInput({
  type,
  options,
  max,
  value,
  onChange,
}: {
  type: FieldType;
  options: DraftOption[];
  max: number;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (type) {
    case FieldType.TEXT:
      return (
        <input
          aria-label="Default value"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={selectClass}
          placeholder="No default"
        />
      );
    case FieldType.NUMBER:
      return (
        <input
          aria-label="Default value"
          type="number"
          step="any"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={selectClass}
          placeholder="No default"
        />
      );
    case FieldType.BOOLEAN:
      return (
        <select
          aria-label="Default value"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
          className={selectClass}
        >
          <option value="">No default</option>
          <option value="true">Checked</option>
          <option value="false">Not checked</option>
        </select>
      );
    case FieldType.RATING:
      return (
        <select
          aria-label="Default value"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={selectClass}
        >
          <option value="">No default</option>
          {Array.from({ length: max }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {'★'.repeat(i + 1)}
            </option>
          ))}
        </select>
      );
    case FieldType.SELECT:
      return (
        <select
          aria-label="Default value"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={selectClass}
        >
          <option value="">No default</option>
          {options
            .filter((o) => o.label.trim())
            .map((o) => (
              <option key={o.key} value={optionValue(o)}>
                {o.label}
              </option>
            ))}
        </select>
      );
    case FieldType.MULTI_SELECT: {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Default value">
          {options
            .filter((o) => o.label.trim())
            .map((o) => (
              <label key={o.key} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(optionValue(o))}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, optionValue(o)]
                      : selected.filter((v) => v !== optionValue(o));
                    onChange(next.length ? next : undefined);
                  }}
                />
                {o.label}
              </label>
            ))}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * Creates a field (pick a type, then its settings) or edits one. A field's name and type are
 * fixed once created, because records already store values in that shape.
 */
export function FieldDialog({
  object,
  objects,
  field,
  onClose,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  /** Present when editing. */
  field?: FieldMetadataDto;
  onClose: () => void;
}) {
  const editing = Boolean(field);
  const create = useCreateField();
  const update = useUpdateField();
  const [label, setLabel] = useState(field?.label ?? '');
  const [name, setName] = useState(field?.name ?? '');
  const [nameEdited, setNameEdited] = useState(editing);
  const [type, setType] = useState<FieldType | null>(field?.type ?? null);
  const [description, setDescription] = useState(field?.description ?? '');
  const [isRequired, setIsRequired] = useState(field?.isRequired ?? false);
  const [options, setOptions] = useState<DraftOption[]>(() =>
    draftFromOptions(field?.options ?? null),
  );
  const [max, setMax] = useState(field?.settings?.max ?? 5);
  const [currency, setCurrency] = useState(field?.settings?.currency ?? 'USD');
  const [defaultValue, setDefaultValue] = useState<unknown>(field?.defaultValue ?? undefined);
  const [target, setTarget] = useState(field?.relation?.targetObjectName ?? '');
  const [inverseName, setInverseName] = useState(field?.relation?.inverseName ?? object.namePlural);
  const [inverseLabel, setInverseLabel] = useState(
    field?.relation?.inverseLabel ?? object.labelPlural,
  );
  const [onDelete, setOnDelete] = useState<RelationOnDelete>(
    field?.relation?.onDelete ?? 'SET_NULL',
  );
  const mutation = editing ? update : create;
  const targets = objects.filter((o) => !o.deletedAt);
  const apiName = nameEdited ? name : labelToApiName(label);

  function changeType(next: FieldType) {
    setType(next);
    setDefaultValue(undefined);
    if (isSelect(next) && options.length === 0) {
      setOptions(
        draftFromOptions([]).concat([
          { key: 'o1', label: 'Option 1', color: 'blue' },
          { key: 'o2', label: 'Option 2', color: 'green' },
        ]),
      );
    }
    if (next === FieldType.RELATION && !target)
      setTarget(targets.find((o) => o.id !== object.id)?.nameSingular ?? object.nameSingular);
  }

  const optionPayload = () =>
    options
      .filter((o) => o.label.trim())
      .map((o) => ({
        label: o.label.trim(),
        color: o.color,
        ...(o.value ? { value: o.value } : {}),
      }));

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!type) return;
    const settings =
      type === FieldType.RATING ? { max } : type === FieldType.CURRENCY ? { currency } : undefined;
    if (editing && field) {
      const changes: UpdateFieldInput = {
        label: label.trim(),
        description: description.trim() || null,
        isRequired,
        ...(isSelect(type) ? { options: optionPayload() } : {}),
        ...(settings ? { settings } : {}),
        ...(FIELD_TYPE_INFO[type].supportsDefault ? { defaultValue: defaultValue ?? null } : {}),
        ...(type === FieldType.RELATION ? { relation: { inverseLabel: inverseLabel.trim() } } : {}),
      };
      update.mutate({ id: field.id, changes }, { onSuccess: onClose });
    } else {
      const input: CreateFieldInput = {
        label: label.trim(),
        name: apiName,
        type,
        isRequired,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(isSelect(type) ? { options: optionPayload() } : {}),
        ...(settings ? { settings } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(type === FieldType.RELATION
          ? {
              relation: {
                targetObject: target,
                inverseName: inverseName.trim(),
                inverseLabel: inverseLabel.trim(),
                onDelete,
              },
            }
          : {}),
      };
      create.mutate({ objectId: object.id, input }, { onSuccess: onClose });
    }
  }

  const canSubmit = Boolean(
    type && label.trim() && (!isSelect(type) || optionPayload().length > 0),
  );

  return (
    <Dialog
      title={editing ? `Edit field “${field!.label}”` : `New field on ${object.labelPlural}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} disabled={!canSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Create field'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Label"
          autoFocus
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Close date"
        />
        {editing ? (
          <p className="-mt-3 text-xs text-muted">
            API name <code className="font-mono">{field!.name}</code> ·{' '}
            {FIELD_TYPE_INFO[field!.type].label} (name and type can’t change)
          </p>
        ) : (
          <TextField
            label="API name"
            value={apiName}
            onChange={(e) => {
              setNameEdited(true);
              setName(e.target.value);
            }}
            hint="Used in the API and the SDK. camelCase, can’t be changed later."
            className="-mt-2"
          />
        )}

        {!editing && (
          <Section title="Type">
            <TypePicker value={type} onChange={changeType} />
          </Section>
        )}

        {type && isSelect(type) && (
          <Section title="Options">
            <OptionsEditor
              options={options}
              onChange={setOptions}
              savedValues={editing ? (field!.options ?? []).map((o) => o.value) : []}
            />
          </Section>
        )}

        {type === FieldType.RATING && (
          <Section title="Number of stars">
            <select
              aria-label="Number of stars"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
              className={selectClass}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </Section>
        )}

        {type === FieldType.CURRENCY && (
          <Section title="Default currency">
            <select
              aria-label="Default currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={selectClass}
            >
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Section>
        )}

        {type === FieldType.RELATION && (
          <Section
            title="Links to"
            hint={
              editing
                ? undefined
                : `Each ${object.labelSingular.toLowerCase()} links to one record of the chosen object.`
            }
          >
            {editing ? (
              <p className="text-sm">
                {objects.find((o) => o.nameSingular === target)?.labelPlural ?? target}
              </p>
            ) : (
              <select
                aria-label="Links to"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={selectClass}
              >
                {targets.map((o) => (
                  <option key={o.id} value={o.nameSingular}>
                    {o.labelPlural}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label={`Shown on ${objects.find((o) => o.nameSingular === target)?.labelSingular ?? 'the other object'} as`}
                value={inverseLabel}
                onChange={(e) => setInverseLabel(e.target.value)}
              />
              {!editing && (
                <TextField
                  label="Reverse API name"
                  value={inverseName}
                  onChange={(e) => setInverseName(e.target.value)}
                />
              )}
            </div>
            {!editing && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">
                  When the linked record is permanently deleted
                </span>
                <select
                  aria-label="On delete"
                  value={onDelete}
                  onChange={(e) => setOnDelete(e.target.value as RelationOnDelete)}
                  className={selectClass}
                >
                  <option value="SET_NULL">Clear the link</option>
                  <option value="CASCADE">Delete this record too</option>
                  <option value="RESTRICT">Prevent the deletion</option>
                </select>
              </label>
            )}
          </Section>
        )}

        {type && FIELD_TYPE_INFO[type].supportsDefault && (
          <Section title="Default value" hint="Used for new records when no value is given.">
            <DefaultValueInput
              type={type}
              options={options}
              max={max}
              value={defaultValue}
              onChange={setDefaultValue}
            />
          </Section>
        )}

        {type && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              Required (records can’t be saved without it)
            </label>
            <TextField
              label="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </>
        )}

        <FormError error={mutation.error} />
      </form>
    </Dialog>
  );
}
