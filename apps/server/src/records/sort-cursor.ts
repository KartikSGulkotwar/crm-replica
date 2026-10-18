import { FieldType, SortDirection } from '@crm-replica/shared';
import { ident } from '../schema-sync/sql';
import { filterColumn, FilterError } from './filter-builder';
import { FieldModel, findField, ObjectModel } from './object-model';
import { SqlParams } from './sql-params';

const MAX_SORTS = 5;
const UNSORTABLE = [FieldType.MULTI_SELECT, FieldType.RELATION];

export interface SortKey {
  field: FieldModel;
  direction: SortDirection;
}

/** Parses `sort=name:asc,createdAt:desc`. Defaults to manual order (position). */
export function parseSortParam(object: ObjectModel, raw: unknown): SortKey[] {
  if (raw === undefined || raw === '')
    return [{ field: findField(object, 'position')!, direction: 'asc' }];
  if (typeof raw !== 'string') throw new FilterError('sort must be like name:asc,createdAt:desc');
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > MAX_SORTS) throw new FilterError(`At most ${MAX_SORTS} sort fields`);
  const keys = parts.map((part) => {
    const [name, dir = 'asc', ...rest] = part.split(':');
    if (rest.length || (dir !== 'asc' && dir !== 'desc'))
      throw new FilterError(`Invalid sort "${part}"; use field:asc or field:desc`);
    const field = findField(object, name);
    if (!field) throw new FilterError(`Unknown sort field "${name}" on ${object.labelSingular}`);
    if (field.name === 'id' || (UNSORTABLE.includes(field.type) && !field.system)) {
      throw new FilterError(`Can’t sort by ${field.label}`);
    }
    return { field, direction: dir as SortDirection };
  });
  const names = keys.map((k) => k.field.name);
  if (new Set(names).size !== names.length)
    throw new FilterError('Each field can appear in sort only once');
  return keys;
}

/** Signature that ties a cursor to the sort it was created with. */
const signature = (keys: SortKey[]) => keys.map((k) => `${k.field.name}:${k.direction}`).join(',');

interface SortExpression {
  key: SortKey;
  /** SQL expression (over alias `t`) ordered on. */
  expr: string;
  /** Cast for cursor values compared against `expr`. */
  cast: string;
  alias: string;
}

/**
 * Builds ORDER BY and cursor logic. Every key sorts NULLS LAST, and `id` breaks ties, so the
 * order is total and keyset pagination never skips or repeats a row.
 */
export class SortPlan {
  readonly expressions: SortExpression[];

  constructor(
    readonly keys: SortKey[],
    params: SqlParams,
  ) {
    this.expressions = keys.map((key, i) => {
      const { column, sqlType } = filterColumn(key.field);
      const col = `t.${ident(column)}`;
      if (key.field.type === FieldType.SELECT) {
        // Selects sort by their option order (New, Qualified, Proposal…), not alphabetically.
        const order = params.add((key.field.options ?? []).map((o) => o.value));
        return {
          key,
          expr: `array_position(${order}::text[], ${col})`,
          cast: 'integer',
          alias: `__sort_${i}`,
        };
      }
      return { key, expr: col, cast: sqlType, alias: `__sort_${i}` };
    });
  }

  selectList(): string {
    return this.expressions.map((e) => `${e.expr} AS ${ident(e.alias)}`).join(', ');
  }

  orderBy(): string {
    return [
      ...this.expressions.map((e) => `${e.expr} ${e.key.direction.toUpperCase()} NULLS LAST`),
      't."id" ASC',
    ].join(', ');
  }

  encodeCursor(row: Record<string, unknown>): string {
    const values = this.expressions.map((e) => {
      const v = row[e.alias];
      return v instanceof Date ? v.toISOString() : (v ?? null);
    });
    return Buffer.from(
      JSON.stringify({ s: signature(this.keys), v: [...values, row.id] }),
    ).toString('base64url');
  }

  /** "Strictly after the cursor row" as SQL, with cursor values bound as parameters. */
  afterCursor(cursor: string, params: SqlParams): string {
    let decoded: { s?: unknown; v?: unknown };
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw new FilterError('Invalid cursor');
    }
    const values = decoded.v;
    if (
      decoded.s !== signature(this.keys) ||
      !Array.isArray(values) ||
      values.length !== this.expressions.length + 1
    ) {
      throw new FilterError(
        'This cursor belongs to a different sort or filter; start again without a cursor',
      );
    }
    for (const v of values) {
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        throw new FilterError('Invalid cursor');
      }
    }
    const id = values[values.length - 1];
    if (typeof id !== 'string') throw new FilterError('Invalid cursor');

    const equal = (e: SortExpression, v: unknown) =>
      v === null ? `${e.expr} IS NULL` : `${e.expr} = ${params.add(v)}::${e.cast}`;
    const after = (e: SortExpression, v: unknown) =>
      v === null
        ? 'FALSE' // nothing sorts after NULL (nulls are last) except via a later key
        : `(${e.expr} ${e.key.direction === 'asc' ? '>' : '<'} ${params.add(v)}::${e.cast} OR ${e.expr} IS NULL)`;

    const clauses: string[] = [];
    for (let i = 0; i <= this.expressions.length; i++) {
      const prefix = this.expressions.slice(0, i).map((e, j) => equal(e, values[j]));
      const tail =
        i < this.expressions.length
          ? after(this.expressions[i], values[i])
          : `t."id" > ${params.add(id)}::uuid`;
      clauses.push(`(${[...prefix, tail].join(' AND ')})`);
    }
    return `(${clauses.join(' OR ')})`;
  }
}
