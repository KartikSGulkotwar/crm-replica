import { FIELD_TYPE_INFO, FieldType, FilterOperator } from '@crm-replica/shared';
import { ident } from '../schema-sync/sql';
import { FieldModel, findField, ObjectModel } from './object-model';
import { SqlParams } from './sql-params';
import { isValidDate, parseDateTime, UUID } from './value-codec';

export class FilterError extends Error {}

const MAX_DEPTH = 6;
const MAX_CONDITIONS = 50;
const MAX_LIST = 200;
const MAX_TEXT = 1000;

/** id / createdBy are uuids: equality and lists only. */
const UUID_OPS: FilterOperator[] = ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
const LIST_OPS: FilterOperator[] = ['in', 'notIn', 'containsAny', 'containsAll'];
const TEXT_TYPES = [FieldType.TEXT, FieldType.EMAIL, FieldType.PHONE, FieldType.LINK];

/** The column a filter or sort uses for a field (amount for currency). */
export function filterColumn(field: FieldModel): { column: string; sqlType: string } {
  return field.type === FieldType.CURRENCY
    ? field.columns.find((c) => c.part === 'amount')!
    : field.columns[0];
}

/** Postgres type a field's filter values are bound as. */
function valueCast(field: FieldModel): string {
  switch (field.type) {
    case FieldType.NUMBER:
      return 'double precision';
    case FieldType.CURRENCY:
      return 'numeric';
    case FieldType.RATING:
      return 'integer';
    case FieldType.BOOLEAN:
      return 'boolean';
    case FieldType.DATE:
      return 'date';
    case FieldType.DATE_TIME:
      return 'timestamptz';
    case FieldType.RELATION:
      return 'uuid';
    default:
      return 'text';
  }
}

/** Validates one filter value for a field; returns the value to bind. */
function checkValue(field: FieldModel, value: unknown): unknown {
  const bad = (what: string) => new FilterError(`Filter value for "${field.name}" must be ${what}`);
  switch (field.type) {
    case FieldType.TEXT:
    case FieldType.EMAIL:
    case FieldType.PHONE:
    case FieldType.LINK:
      if (typeof value !== 'string' || value.length > MAX_TEXT) throw bad('text');
      return value;
    case FieldType.NUMBER:
    case FieldType.CURRENCY:
    case FieldType.RATING:
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('a number');
      return value;
    case FieldType.BOOLEAN:
      if (typeof value !== 'boolean') throw bad('true or false');
      return value;
    case FieldType.DATE:
      if (typeof value !== 'string' || !isValidDate(value)) throw bad('a date like 2026-01-31');
      return value;
    case FieldType.DATE_TIME: {
      const iso =
        typeof value === 'string'
          ? isValidDate(value)
            ? `${value}T00:00:00.000Z`
            : parseDateTime(value)
          : null;
      if (!iso) throw bad('an ISO date or date-time');
      return iso;
    }
    case FieldType.SELECT:
    case FieldType.MULTI_SELECT: {
      const values = (field.options ?? []).map((o) => o.value);
      if (typeof value !== 'string' || !values.includes(value))
        throw bad(`one of: ${values.join(', ')}`);
      return value;
    }
    case FieldType.RELATION:
      if (typeof value !== 'string' || !UUID.test(value)) throw bad('a record id (uuid)');
      return value;
  }
}

/** `%` and `_` in the search text are literal, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

interface BuildState {
  object: ObjectModel;
  params: SqlParams;
  conditions: number;
  alias: string;
}

function condition(state: BuildState, node: Record<string, unknown>): string {
  const extra = Object.keys(node).filter((k) => !['field', 'op', 'value'].includes(k));
  if (extra.length) throw new FilterError(`Unknown keys in filter condition: ${extra.join(', ')}`);
  if (typeof node.field !== 'string')
    throw new FilterError('Each filter condition needs a "field"');
  if (typeof node.op !== 'string') throw new FilterError(`Filter on "${node.field}" needs an "op"`);

  const field = findField(state.object, node.field);
  if (!field)
    throw new FilterError(`Unknown field "${node.field}" on ${state.object.labelSingular}`);
  const op = node.op as FilterOperator;
  const allowed =
    field.system && field.type === FieldType.RELATION
      ? UUID_OPS
      : FIELD_TYPE_INFO[field.type].operators;
  if (!allowed.includes(op)) {
    throw new FilterError(
      `Operator "${node.op}" isn’t supported for ${field.label} (${FIELD_TYPE_INFO[field.type].label}); use one of: ${allowed.join(', ')}`,
    );
  }

  // The column name comes from metadata (never from the request) and still passes ident().
  const col = `${state.alias}.${ident(filterColumn(field).column)}`;
  const cast = valueCast(field);

  if (op === 'isEmpty' || op === 'isNotEmpty') {
    const empty = TEXT_TYPES.includes(field.type)
      ? `(${col} IS NULL OR ${col} = '')`
      : field.type === FieldType.MULTI_SELECT
        ? `(${col} IS NULL OR cardinality(${col}) = 0)`
        : `${col} IS NULL`;
    return op === 'isEmpty' ? empty : `NOT ${empty}`;
  }

  if (LIST_OPS.includes(op)) {
    if (!Array.isArray(node.value) || node.value.length === 0 || node.value.length > MAX_LIST) {
      throw new FilterError(`"${op}" on "${field.name}" needs a list of 1 to ${MAX_LIST} values`);
    }
    const p = state.params.add(node.value.map((v) => checkValue(field, v)));
    switch (op) {
      case 'in':
        return `${col} = ANY(${p}::${cast}[])`;
      case 'notIn':
        return `(${col} IS NULL OR NOT (${col} = ANY(${p}::${cast}[])))`;
      case 'containsAny':
        return `${col} && ${p}::text[]`;
      default:
        return `${col} @> ${p}::text[]`;
    }
  }

  const value = checkValue(field, node.value);
  if (op === 'contains' || op === 'notContains' || op === 'startsWith') {
    const pattern =
      op === 'startsWith' ? `${escapeLike(value as string)}%` : `%${escapeLike(value as string)}%`;
    const p = state.params.add(pattern);
    const like = `${col} ILIKE ${p}::text ESCAPE '\\'`;
    return op === 'notContains' ? `(${col} IS NULL OR NOT (${like}))` : like;
  }

  const p = `${state.params.add(value)}::${cast}`;
  switch (op) {
    case 'eq':
      // An unset checkbox counts as false.
      return field.type === FieldType.BOOLEAN ? `COALESCE(${col}, false) = ${p}` : `${col} = ${p}`;
    case 'neq':
      return field.type === FieldType.BOOLEAN
        ? `COALESCE(${col}, false) <> ${p}`
        : `${col} IS DISTINCT FROM ${p}`;
    case 'gt':
      return `${col} > ${p}`;
    case 'gte':
      return `${col} >= ${p}`;
    case 'lt':
      return `${col} < ${p}`;
    case 'lte':
      return `${col} <= ${p}`;
    default:
      throw new FilterError(`Unsupported operator "${op}"`);
  }
}

function node(state: BuildState, value: unknown, depth: number): string {
  if (depth > MAX_DEPTH)
    throw new FilterError(`Filters can be nested at most ${MAX_DEPTH} levels deep`);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FilterError('Each filter must be an object');
  }
  const obj = value as Record<string, unknown>;
  for (const group of ['and', 'or'] as const) {
    if (group in obj) {
      if (Object.keys(obj).length !== 1)
        throw new FilterError(`"${group}" must be the only key in its object`);
      const children = obj[group];
      if (!Array.isArray(children) || children.length === 0)
        throw new FilterError(`"${group}" needs a non-empty list`);
      return `(${children.map((c) => node(state, c, depth + 1)).join(group === 'and' ? ' AND ' : ' OR ')})`;
    }
  }
  if ('not' in obj) {
    if (Object.keys(obj).length !== 1)
      throw new FilterError('"not" must be the only key in its object');
    return `NOT (${node(state, obj.not, depth + 1)})`;
  }
  if (++state.conditions > MAX_CONDITIONS)
    throw new FilterError(`Filters can have at most ${MAX_CONDITIONS} conditions`);
  return condition(state, obj);
}

/**
 * Turns a JSON filter tree into a SQL boolean expression over table alias `alias`.
 * Field names are resolved against the object's metadata and every value is a bound parameter,
 * so nothing from the request is ever spliced into the SQL text.
 */
export function buildFilterSql(
  object: ObjectModel,
  filter: unknown,
  params: SqlParams,
  alias = 't',
): string {
  return node({ object, params, conditions: 0, alias }, filter, 1);
}

/** Parses the `filter` query parameter (JSON). */
export function parseFilterParam(raw: unknown): unknown {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new FilterError('filter must be a single JSON value');
  if (raw.length > 20_000) throw new FilterError('filter is too long');
  try {
    return JSON.parse(raw);
  } catch {
    throw new FilterError(
      'filter must be valid JSON, e.g. {"field":"name","op":"contains","value":"acme"}',
    );
  }
}
