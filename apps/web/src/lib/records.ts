import type {
  FieldMetadataDto,
  ListRecordsResponse,
  ObjectMetadataDto,
  RecordDto,
} from '@crm-replica/shared';
import { FieldType } from '@crm-replica/shared';
import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, send } from './api';

const PAGE_SIZE = 50;

export const recordsKey = (plural: string) => ['records', plural];
export const recordKey = (plural: string, id: string) => ['records', plural, 'one', id];

/** Relations to expand so tables can show linked records by name (the API allows 5). */
export function relationExpands(object: ObjectMetadataDto): string[] {
  return object.fields
    .filter((f) => f.type === FieldType.RELATION)
    .slice(0, 5)
    .map((f) => f.name);
}

export interface ListParams {
  filter?: unknown;
  sort?: string;
  expand?: string[];
}

function queryString(params: ListParams & { limit?: number; cursor?: string | null }) {
  const qs = new URLSearchParams();
  if (params.filter) qs.set('filter', JSON.stringify(params.filter));
  if (params.sort) qs.set('sort', params.sort);
  if (params.expand?.length) qs.set('expand', params.expand.join(','));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  return qs.toString();
}

/** Pages of records for infinite scrolling. */
export function useRecordsInfinite(plural: string, params: ListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...recordsKey(plural), 'list', params],
    queryFn: ({ pageParam }) =>
      api<ListRecordsResponse>(
        `/objects/${plural}?${queryString({ ...params, limit: PAGE_SIZE, cursor: pageParam })}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
    enabled,
  });
}

/** A small, one-off search (e.g. for a relation picker). */
export function useRecordSearch(
  plural: string | undefined,
  params: ListParams & { limit?: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...recordsKey(plural ?? ''), 'search', params],
    queryFn: () =>
      api<ListRecordsResponse>(
        `/objects/${plural}?${queryString({ ...params, limit: params.limit ?? 20 })}`,
      ),
    enabled: enabled && Boolean(plural),
  });
}

export function useRecord(plural: string, id: string, expand: string[]) {
  return useQuery({
    queryKey: [...recordKey(plural, id), expand],
    queryFn: () =>
      api<RecordDto>(
        `/objects/${plural}/${id}${expand.length ? `?expand=${expand.join(',')}` : ''}`,
      ),
  });
}

type Pages = InfiniteData<ListRecordsResponse>;

/** Applies a change to every cached copy of a record (all list pages and single-record views). */
function patchCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  plural: string,
  id: string,
  patch: (r: RecordDto) => RecordDto,
) {
  queryClient.setQueriesData<Pages>(
    { queryKey: [...recordsKey(plural), 'list'] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          data: p.data.map((r) => (r.id === id ? patch(r) : r)),
        })),
      },
  );
  queryClient.setQueriesData<RecordDto>({ queryKey: recordKey(plural, id) }, (r) => r && patch(r));
}

/**
 * Saves one field. The UI updates immediately (optimistic) and rolls back if the server
 * rejects the value; linked-record names are refreshed once the save completes.
 */
export function useUpdateRecord(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Record<string, unknown>;
      optimistic?: Record<string, unknown>;
    }) => send<RecordDto>('PATCH', `/objects/${plural}/${id}`, values),
    onMutate: async ({ id, values, optimistic }) => {
      await queryClient.cancelQueries({ queryKey: recordsKey(plural) });
      const snapshot = queryClient.getQueriesData({ queryKey: recordsKey(plural) });
      // `optimistic` can carry display-only data, e.g. the newly linked record for a relation.
      patchCaches(queryClient, plural, id, (r) => ({ ...r, ...values, ...optimistic }));
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: (saved, { id, values }) => {
      patchCaches(queryClient, plural, id, (r) => ({ ...r, ...saved }));
      // Other objects may show this record (e.g. a company's people list), so refresh them.
      void queryClient.invalidateQueries({
        queryKey: ['records'],
        predicate: (q) => q.queryKey[1] !== plural,
      });
      if (Object.keys(values).some((k) => k.endsWith('Id')))
        void queryClient.invalidateQueries({ queryKey: recordsKey(plural) });
    },
  });
}

export function useCreateRecord(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      send<RecordDto>('POST', `/objects/${plural}`, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recordsKey(plural) }),
  });
}

export function useDeleteRecords(plural: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      send<{ deletedIds: string[] }>('POST', `/objects/${plural}/batch-delete`, { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
  });
}

/** The value a field shows for a record (relations are keyed `<name>Id`). */
export function fieldKey(field: FieldMetadataDto): string {
  return field.type === FieldType.RELATION ? `${field.name}Id` : field.name;
}
