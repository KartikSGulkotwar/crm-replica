import type { ObjectMetadataDto, RecordDto } from '@crm-replica/shared';

/**
 * The text a record is shown as: its title field, or "First Last" for objects titled by a
 * first name that also have a last name (like People).
 */
export function recordLabel(
  object: ObjectMetadataDto | undefined,
  record: RecordDto | null | undefined,
): string {
  if (!record) return '';
  const key = object?.labelIdentifierFieldName;
  const title = key ? record[key] : undefined;
  let label = typeof title === 'string' ? title.trim() : '';
  if (key === 'firstName' && object?.fields.some((f) => f.name === 'lastName')) {
    label = [label, typeof record.lastName === 'string' ? record.lastName.trim() : '']
      .filter(Boolean)
      .join(' ');
  }
  return label || `Untitled ${object?.labelSingular.toLowerCase() ?? 'record'}`;
}

/** Fields searched when picking a record (e.g. in a relation picker). */
export function searchFields(object: ObjectMetadataDto): string[] {
  const key = object.labelIdentifierFieldName;
  if (!key) return [];
  return key === 'firstName' && object.fields.some((f) => f.name === 'lastName')
    ? ['firstName', 'lastName']
    : [key];
}
