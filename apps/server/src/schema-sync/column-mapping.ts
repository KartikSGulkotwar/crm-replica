import { camelToSnake, FieldType } from '@crm-replica/shared';

export interface ColumnSpec {
  /** Postgres column name. */
  column: string;
  /** Postgres type (a fixed string from this file, never user input). */
  sqlType: string;
  /** Which part of the field value this column holds (for composite types). */
  part?: 'amount' | 'currency';
}

/**
 * How each field type is stored. Most use one column named after the field; CURRENCY uses
 * two, and RELATION stores the target's id in `<name>_id`.
 */
export function columnsForField(name: string, type: FieldType): ColumnSpec[] {
  const base = camelToSnake(name);
  switch (type) {
    case FieldType.TEXT:
    case FieldType.EMAIL:
    case FieldType.PHONE:
    case FieldType.LINK:
    case FieldType.SELECT:
      return [{ column: base, sqlType: 'text' }];
    case FieldType.NUMBER:
      return [{ column: base, sqlType: 'double precision' }];
    case FieldType.CURRENCY:
      return [
        { column: `${base}_amount`, sqlType: 'numeric(18,2)', part: 'amount' },
        { column: `${base}_currency`, sqlType: 'text', part: 'currency' },
      ];
    case FieldType.BOOLEAN:
      return [{ column: base, sqlType: 'boolean' }];
    case FieldType.DATE:
      return [{ column: base, sqlType: 'date' }];
    case FieldType.DATE_TIME:
      return [{ column: base, sqlType: 'timestamptz' }];
    case FieldType.MULTI_SELECT:
      return [{ column: base, sqlType: 'text[]' }];
    case FieldType.RATING:
      return [{ column: base, sqlType: 'smallint' }];
    case FieldType.RELATION:
      return [{ column: `${base}_id`, sqlType: 'uuid' }];
  }
}

/** Columns every record table gets, in addition to its fields' columns. */
export const SYSTEM_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'position',
];
