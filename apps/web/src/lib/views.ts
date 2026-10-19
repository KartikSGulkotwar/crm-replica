import type { CreateViewInput, RecordFilter, UpdateViewInput, ViewDto } from '@crm-replica/shared';
import { FieldType, ObjectMetadataDto, serializeSort } from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send } from './api';

export const viewsKey = (plural: string) => ['views', plural];

export function useViews(plural: string | undefined) {
  return useQuery({
    queryKey: viewsKey(plural ?? ''),
    queryFn: () => api<ViewDto[]>(`/views?object=${encodeURIComponent(plural!)}`),
    enabled: Boolean(plural),
  });
}

/** Saves view changes; the UI updates immediately and rolls back if the server refuses. */
export function useUpdateView(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateViewInput }) =>
      send<ViewDto>('PATCH', `/views/${id}`, changes),
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: viewsKey(plural) });
      const previous = queryClient.getQueryData<ViewDto[]>(viewsKey(plural));
      queryClient.setQueryData<ViewDto[]>(viewsKey(plural), (views) =>
        views?.map((v) =>
          v.id === id
            ? ({
                ...v,
                ...changes,
                fields: changes.fields
                  ? changes.fields.map((f, position) => ({
                      isVisible: true,
                      width: null,
                      ...f,
                      position,
                    }))
                  : v.fields,
              } as ViewDto)
            : v,
        ),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(viewsKey(plural), ctx?.previous),
    onSuccess: (saved) =>
      queryClient.setQueryData<ViewDto[]>(viewsKey(plural), (views) =>
        views?.map((v) => (v.id === saved.id ? saved : v)),
      ),
  });
}

export function useCreateView(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateViewInput) => send<ViewDto>('POST', '/views', input),
    onSuccess: (view) =>
      queryClient.setQueryData<ViewDto[]>(viewsKey(plural), (views) => [...(views ?? []), view]),
  });
}

export function useDeleteView(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>('DELETE', `/views/${id}`),
    onSuccess: (_r, id) =>
      queryClient.setQueryData<ViewDto[]>(viewsKey(plural), (views) =>
        views?.filter((v) => v.id !== id),
      ),
  });
}

/** The records-API filter tree for a view (plus optional extra conditions, e.g. a kanban column). */
export function viewFilter(
  view: ViewDto | undefined,
  ...extra: RecordFilter[]
): RecordFilter | undefined {
  const own = (view?.filters ?? []).map(
    (f) => ({ field: f.fieldName, op: f.operator, value: f.value }) as RecordFilter,
  );
  const combined: RecordFilter | undefined = own.length
    ? own.length === 1
      ? own[0]
      : view!.filterConjunction === 'or'
        ? { or: own }
        : { and: own }
    : undefined;
  const parts = [combined, ...extra].filter(Boolean) as RecordFilter[];
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { and: parts };
}

export function viewSort(view: ViewDto | undefined): string | undefined {
  return view?.sorts.length
    ? serializeSort(view.sorts.map((s) => ({ field: s.fieldName, direction: s.direction })))
    : undefined;
}

export const selectFields = (object: ObjectMetadataDto) =>
  object.fields.filter((f) => f.type === FieldType.SELECT);
