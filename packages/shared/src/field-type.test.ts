import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, FieldType, isFieldType } from './field-type';

describe('FieldType', () => {
  it('lists the 13 MVP field types', () => {
    expect(FIELD_TYPES).toHaveLength(13);
    expect(FIELD_TYPES).toContain(FieldType.RELATION);
  });

  it('recognises valid and invalid type names', () => {
    expect(isFieldType('CURRENCY')).toBe(true);
    expect(isFieldType('currency')).toBe(false);
    expect(isFieldType(42)).toBe(false);
  });
});
