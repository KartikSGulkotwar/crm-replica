import type {
  CreateFieldInput,
  CreateObjectInput,
  FieldMetadataDto,
  ObjectMetadataDto,
  UpdateFieldInput,
  UpdateObjectInput,
} from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send } from './api';

/** Objects including soft-deleted ones (and their deleted fields), for the settings pages. */
export function useObjectsWithDeleted() {
  return useQuery({
    queryKey: ['metadata', 'objects', 'withDeleted'],
    queryFn: () => api<ObjectMetadataDto[]>('/metadata/objects?includeDeleted=true'),
  });
}

/**
 * Every data-model change refreshes metadata, views and records, so the sidebar, tables and
 * kanban boards reflect it immediately.
 */
function useMetadataMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['metadata'] }),
        queryClient.invalidateQueries({ queryKey: ['views'] }),
        queryClient.invalidateQueries({ queryKey: ['records'] }),
      ]);
    },
  });
}

export const useCreateObject = () =>
  useMetadataMutation((input: CreateObjectInput) =>
    send<ObjectMetadataDto>('POST', '/metadata/objects', input),
  );
export const useUpdateObject = () =>
  useMetadataMutation(({ id, changes }: { id: string; changes: UpdateObjectInput }) =>
    send<ObjectMetadataDto>('PATCH', `/metadata/objects/${id}`, changes),
  );
export const useDeleteObject = () =>
  useMetadataMutation((id: string) => send<ObjectMetadataDto>('DELETE', `/metadata/objects/${id}`));
export const useRestoreObject = () =>
  useMetadataMutation((id: string) =>
    send<ObjectMetadataDto>('POST', `/metadata/objects/${id}/restore`),
  );
export const useDestroyObject = () =>
  useMetadataMutation((id: string) => send<void>('DELETE', `/metadata/objects/${id}/permanent`));

export const useCreateField = () =>
  useMetadataMutation(({ objectId, input }: { objectId: string; input: CreateFieldInput }) =>
    send<FieldMetadataDto>('POST', `/metadata/objects/${objectId}/fields`, input),
  );
export const useUpdateField = () =>
  useMetadataMutation(({ id, changes }: { id: string; changes: UpdateFieldInput }) =>
    send<FieldMetadataDto>('PATCH', `/metadata/fields/${id}`, changes),
  );
export const useDeleteField = () =>
  useMetadataMutation((id: string) => send<FieldMetadataDto>('DELETE', `/metadata/fields/${id}`));
export const useRestoreField = () =>
  useMetadataMutation((id: string) =>
    send<FieldMetadataDto>('POST', `/metadata/fields/${id}/restore`),
  );
export const useDestroyField = () =>
  useMetadataMutation((id: string) => send<void>('DELETE', `/metadata/fields/${id}/permanent`));

/** A reasonable English plural for a label: Project → Projects, Company → Companies. */
export function pluralize(label: string): string {
  const word = label.trim();
  if (!word) return '';
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}
