/** Every kind of field an object can have. See TWENTY_SPEC.md section 4.2. */
export enum FieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  CURRENCY = 'CURRENCY',
  BOOLEAN = 'BOOLEAN',
  DATE = 'DATE',
  DATE_TIME = 'DATE_TIME',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  LINK = 'LINK',
  RATING = 'RATING',
  RELATION = 'RELATION',
}

export const FIELD_TYPES = Object.values(FieldType);

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as string[]).includes(value);
}
