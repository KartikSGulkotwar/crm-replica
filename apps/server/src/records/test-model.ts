import { FieldType, normalizeOptions } from '@crm-replica/shared';
import { columnsForField } from '../schema-sync/column-mapping';
import { FieldModel, ObjectModel, SYSTEM_FIELDS } from './object-model';

/** A hand-built Opportunity-like model for unit tests (no database needed). */
export function testObjectModel(): ObjectModel {
  const field = (name: string, type: FieldType, extra: Partial<FieldModel> = {}): FieldModel => ({
    name,
    apiKey: type === FieldType.RELATION ? `${name}Id` : name,
    label: name,
    type,
    columns: columnsForField(name, type),
    isRequired: false,
    defaultValue: null,
    options: null,
    settings: null,
    ...extra,
  });
  return {
    id: '00000000-0000-0000-0000-000000000001',
    nameSingular: 'opportunity',
    namePlural: 'opportunities',
    labelSingular: 'Opportunity',
    labelPlural: 'Opportunities',
    tableName: 'opportunities',
    isSystem: false,
    labelIdentifierFieldName: 'name',
    systemFields: SYSTEM_FIELDS,
    inverseRelations: [],
    fields: [
      field('name', FieldType.TEXT, { isRequired: true }),
      field('amount', FieldType.CURRENCY, { settings: { currency: 'EUR' } }),
      field('probability', FieldType.NUMBER),
      field('isHot', FieldType.BOOLEAN),
      field('closeDate', FieldType.DATE),
      field('signedAt', FieldType.DATE_TIME),
      field('stage', FieldType.SELECT, {
        options: normalizeOptions(['New', 'Won', 'Lost']),
        defaultValue: 'NEW',
      }),
      field('tags', FieldType.MULTI_SELECT, { options: normalizeOptions(['Enterprise', 'SMB']) }),
      field('contactEmail', FieldType.EMAIL),
      field('phone', FieldType.PHONE),
      field('website', FieldType.LINK),
      field('score', FieldType.RATING, { settings: { max: 3 } }),
      field('company', FieldType.RELATION, { relationTarget: 'company' }),
    ],
  };
}
