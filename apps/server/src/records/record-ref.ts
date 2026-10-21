import { RecordDto, RecordRef } from '@crm-replica/shared';
import { ObjectModel } from './object-model';

/** The record's display title (first + last name for people-like objects). */
export function recordTitle(object: ObjectModel, record: RecordDto): string {
  const key = object.labelIdentifierFieldName;
  let title = key && typeof record[key] === 'string' ? (record[key] as string).trim() : '';
  if (
    key === 'firstName' &&
    object.fields.some((f) => f.name === 'lastName') &&
    typeof record.lastName === 'string'
  ) {
    title = [title, record.lastName.trim()].filter(Boolean).join(' ');
  }
  return title || `Untitled ${object.labelSingular.toLowerCase()}`;
}

export function recordRef(object: ObjectModel, record: RecordDto): RecordRef {
  return {
    object: object.nameSingular,
    objectLabel: object.labelSingular,
    id: record.id,
    title: recordTitle(object, record),
    url: `/objects/${object.namePlural}/${record.id}`,
  };
}
