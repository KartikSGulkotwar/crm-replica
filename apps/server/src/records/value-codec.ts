import { CurrencyValue, FieldType, RecordDto } from '@crm-replica/shared';
import { FieldModel, ObjectModel } from './object-model';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\-\s]{3,40}$/;
const LINK = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]+$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const MAX_TEXT = 100_000;
const MAX_AMOUNT = 1e16;

/** One column assignment for INSERT/UPDATE: always a bound parameter with an explicit cast. */
export interface ColumnValue {
  column: string;
  value: unknown;
  cast: string;
}

export interface ParsedInput {
  columns: ColumnValue[];
  /** API keys present in the input (for change detection). */
  keys: string[];
  /** Relation ids to check for existence: field → id. */
  relationIds: { field: FieldModel; id: string }[];
}

export class RecordValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('; '));
  }
}

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseDateTime(value: string): string | null {
  if (!ISO_DATE_TIME.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** SQL cast used for a column's bound parameters. */
export const castFor = (sqlType: string) => sqlType;

type Converted =
  | { ok: true; columns: { value: unknown; part?: 'amount' | 'currency' }[] }
  | { ok: false; error: string };

const single = (value: unknown): Converted => ({ ok: true, columns: [{ value }] });
const fail = (error: string): Converted => ({ ok: false, error });

/** Checks one input value against its field and converts it to column values. */
function convert(field: FieldModel, raw: unknown): Converted {
  if (raw === undefined) return fail('is undefined');
  const optionValues = (field.options ?? []).map((o) => o.value);

  switch (field.type) {
    case FieldType.TEXT:
      if (raw === null) return single(null);
      if (typeof raw !== 'string') return fail('must be text');
      return raw.length > MAX_TEXT ? fail(`must be at most ${MAX_TEXT} characters`) : single(raw);

    case FieldType.EMAIL:
    case FieldType.PHONE:
    case FieldType.LINK: {
      if (raw === null) return single(null);
      if (typeof raw !== 'string') return fail('must be text');
      const value = raw.trim();
      if (!value) return single(null);
      if (field.type === FieldType.EMAIL && (!EMAIL.test(value) || value.length > 254))
        return fail('must be a valid email address');
      if (field.type === FieldType.PHONE && !PHONE.test(value))
        return fail('must be a valid phone number');
      if (field.type === FieldType.LINK && (!LINK.test(value) || value.length > 2048))
        return fail('must be a valid web address');
      return single(field.type === FieldType.EMAIL ? value.toLowerCase() : value);
    }

    case FieldType.NUMBER:
      if (raw === null) return single(null);
      return typeof raw === 'number' && Number.isFinite(raw)
        ? single(raw)
        : fail('must be a number');

    case FieldType.RATING: {
      if (raw === null) return single(null);
      const max = field.settings?.max ?? 5;
      return Number.isInteger(raw) && (raw as number) >= 1 && (raw as number) <= max
        ? single(raw)
        : fail(`must be a whole number from 1 to ${max}`);
    }

    case FieldType.BOOLEAN:
      if (raw === null) return single(null);
      return typeof raw === 'boolean' ? single(raw) : fail('must be true or false');

    case FieldType.DATE:
      if (raw === null) return single(null);
      return typeof raw === 'string' && isValidDate(raw)
        ? single(raw)
        : fail('must be a date like 2026-01-31');

    case FieldType.DATE_TIME: {
      if (raw === null) return single(null);
      const iso = typeof raw === 'string' ? parseDateTime(raw) : null;
      return iso
        ? single(iso)
        : fail('must be an ISO date-time with a time zone, like 2026-01-31T09:00:00Z');
    }

    case FieldType.SELECT:
      if (raw === null) return single(null);
      return typeof raw === 'string' && optionValues.includes(raw)
        ? single(raw)
        : fail(`must be one of: ${optionValues.join(', ')}`);

    case FieldType.MULTI_SELECT: {
      if (raw === null) return single([]);
      if (
        !Array.isArray(raw) ||
        !raw.every((v) => typeof v === 'string' && optionValues.includes(v))
      ) {
        return fail(`must be a list of: ${optionValues.join(', ')}`);
      }
      return single([...new Set(raw as string[])]);
    }

    case FieldType.CURRENCY: {
      if (raw === null)
        return {
          ok: true,
          columns: [
            { value: null, part: 'amount' },
            { value: null, part: 'currency' },
          ],
        };
      if (typeof raw !== 'object' || Array.isArray(raw))
        return fail('must be an object like { "amount": 1000, "currency": "USD" }');
      const { amount, currency, ...rest } = raw as Record<string, unknown>;
      if (Object.keys(rest).length)
        return fail(`has unknown keys: ${Object.keys(rest).join(', ')}`);
      if (
        amount !== null &&
        amount !== undefined &&
        (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) >= MAX_AMOUNT)
      ) {
        return fail('amount must be a number');
      }
      if (
        currency !== undefined &&
        currency !== null &&
        (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
      ) {
        return fail('currency must be a 3-letter code like USD');
      }
      const hasAmount = typeof amount === 'number';
      return {
        ok: true,
        columns: [
          { value: hasAmount ? amount : null, part: 'amount' },
          {
            value: hasAmount
              ? ((currency as string | undefined) ?? field.settings?.currency ?? 'USD')
              : null,
            part: 'currency',
          },
        ],
      };
    }

    case FieldType.RELATION:
      if (raw === null) return single(null);
      return typeof raw === 'string' && UUID.test(raw)
        ? single(raw.toLowerCase())
        : fail('must be a record id (uuid)');
  }
}

/**
 * Validates a create/update body against the object's fields. Unknown keys, read-only system
 * keys and invalid values are all reported together.
 */
export function parseRecordInput(
  object: ObjectModel,
  body: unknown,
  mode: 'create' | 'update',
): ParsedInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RecordValidationError(['Body must be a JSON object']);
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];
  const result: ParsedInput = { columns: [], keys: [], relationIds: [] };

  for (const [key, raw] of Object.entries(input)) {
    if (key === 'id' && mode === 'create') {
      if (typeof raw === 'string' && UUID.test(raw))
        result.columns.push({ column: 'id', value: raw.toLowerCase(), cast: 'uuid' });
      else errors.push('id must be a uuid');
      continue;
    }
    if (key === 'position') {
      if (typeof raw === 'number' && Number.isFinite(raw))
        result.columns.push({ column: 'position', value: raw, cast: 'double precision' });
      else errors.push('position must be a number');
      result.keys.push('position');
      continue;
    }
    if (['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy'].includes(key)) {
      errors.push(`${key} is set automatically and can’t be changed`);
      continue;
    }
    const field = object.fields.find((f) => f.apiKey === key);
    if (!field) {
      const relation = object.fields.find((f) => f.name === key && f.type === FieldType.RELATION);
      errors.push(
        relation
          ? `Use ${relation.apiKey} to set ${relation.label}`
          : `Unknown field "${key}" on ${object.labelSingular}`,
      );
      continue;
    }
    const converted = convert(field, raw);
    if (!converted.ok) {
      errors.push(`${key} ${converted.error}`);
      continue;
    }
    converted.columns.forEach((c, i) => {
      const spec = c.part ? field.columns.find((col) => col.part === c.part)! : field.columns[i];
      result.columns.push({ column: spec.column, value: c.value, cast: castFor(spec.sqlType) });
    });
    result.keys.push(key);
    if (field.type === FieldType.RELATION && typeof converted.columns[0].value === 'string') {
      result.relationIds.push({ field, id: converted.columns[0].value });
    }
    if (field.isRequired && isEmptyValue(field, converted.columns[0].value))
      errors.push(`${key} is required`);
  }

  if (mode === 'create') {
    // Missing fields get their default; required fields without one are errors.
    for (const field of object.fields) {
      if (field.apiKey in input) continue;
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        const converted = convert(field, field.defaultValue);
        if (converted.ok) {
          result.columns.push({
            column: field.columns[0].column,
            value: converted.columns[0].value,
            cast: castFor(field.columns[0].sqlType),
          });
          continue;
        }
      }
      if (field.isRequired) errors.push(`${field.apiKey} is required`);
    }
  }

  if (errors.length) throw new RecordValidationError(errors);
  return result;
}

function isEmptyValue(field: FieldModel, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return field.type === FieldType.MULTI_SELECT && Array.isArray(value) && value.length === 0;
}

const toIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value as string | null);

/** Formats one field's column values for the API. */
function fieldValue(field: FieldModel, row: Record<string, unknown>): unknown {
  const col = field.columns[0].column;
  switch (field.type) {
    case FieldType.CURRENCY: {
      const amount = row[field.columns.find((c) => c.part === 'amount')!.column];
      const currency = row[field.columns.find((c) => c.part === 'currency')!.column];
      if (amount === null && currency === null) return null;
      return {
        amount: amount === null ? null : Number(amount),
        currency: (currency as string) ?? null,
      } satisfies CurrencyValue;
    }
    case FieldType.DATE_TIME:
      return toIso(row[col] ?? null);
    case FieldType.MULTI_SELECT:
      return (row[col] as string[] | null) ?? [];
    default:
      return row[col] ?? null;
  }
}

/** A database row → the record JSON the API returns. */
export function rowToRecord(object: ObjectModel, row: Record<string, unknown>): RecordDto {
  const record: RecordDto = {
    id: row.id as string,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    createdBy: (row.created_by as string | null) ?? null,
    position: Number(row.position),
  };
  for (const field of object.fields) record[field.apiKey] = fieldValue(field, row);
  return record;
}
