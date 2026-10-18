import { FIELD_TYPES, FieldType } from '@crm-replica/shared';
import { columnsForField } from './column-mapping';

describe('columnsForField', () => {
  it('maps every field type to at least one column', () => {
    for (const type of FIELD_TYPES)
      expect(columnsForField('myField', type).length).toBeGreaterThan(0);
  });

  it('uses snake_case column names', () => {
    expect(columnsForField('annualRevenue', FieldType.NUMBER)).toEqual([
      { column: 'annual_revenue', sqlType: 'double precision' },
    ]);
  });

  it('splits currency into amount and currency code', () => {
    expect(columnsForField('amount', FieldType.CURRENCY).map((c) => c.column)).toEqual([
      'amount_amount',
      'amount_currency',
    ]);
  });

  it('stores a relation as <name>_id', () => {
    expect(columnsForField('pointOfContact', FieldType.RELATION)).toEqual([
      { column: 'point_of_contact_id', sqlType: 'uuid' },
    ]);
  });
});
