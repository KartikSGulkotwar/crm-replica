import type { FieldMetadataDto, ObjectMetadataDto } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const OBJECTS_KEY = ['metadata', 'objects'];

/** The workspace's data model. Shared by the sidebar, tables and record pages. */
export function useObjects() {
  return useQuery({
    queryKey: OBJECTS_KEY,
    queryFn: () => api<ObjectMetadataDto[]>('/metadata/objects'),
    staleTime: 30_000,
  });
}

/** One object by its plural name (as used in URLs), plus the full list for resolving relations. */
export function useObject(plural: string | undefined) {
  const objects = useObjects();
  const object = objects.data?.find((o) => o.namePlural === plural);
  return { ...objects, object, objects: objects.data ?? [] };
}

/** Fields shown in tables and forms: everything except the record title, which leads. */
export function orderedFields(object: ObjectMetadataDto): FieldMetadataDto[] {
  const title = object.fields.find((f) => f.name === object.labelIdentifierFieldName);
  return title ? [title, ...object.fields.filter((f) => f !== title)] : object.fields;
}

export function findObjectByName(objects: ObjectMetadataDto[], nameSingular: string | undefined) {
  return objects.find((o) => o.nameSingular === nameSingular);
}
