import type {
  RecordActivitiesDto,
  RecordDto,
  RecordRef,
  SearchResultDto,
  TimelinePage,
} from '@crm-replica/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, send } from './api';

// Kept apart from the ['records', …] keys: those caches get patched in place on every edit.
export const activitiesKey = (plural: string, id: string) => ['activities', plural, id];
export const timelineKey = (plural: string, id: string) => ['timeline', plural, id];
const FEED_KEY = ['timeline', 'feed'];

export function useRecordActivities(plural: string, id: string, enabled = true) {
  return useQuery({
    queryKey: activitiesKey(plural, id),
    queryFn: () => api<RecordActivitiesDto>(`/objects/${plural}/${id}/activities`),
    enabled,
  });
}

function timelinePages(key: unknown[], path: string, limit: number) {
  return {
    queryKey: key,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api<TimelinePage>(
        `${path}?limit=${limit}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TimelinePage) => last.nextCursor,
  };
}

export function useTimeline(plural: string, id: string) {
  return useInfiniteQuery(
    timelinePages(timelineKey(plural, id), `/objects/${plural}/${id}/timeline`, 20),
  );
}

export function useActivityFeed() {
  return useInfiniteQuery(timelinePages(FEED_KEY, '/timeline', 15));
}

export function useTargets(plural: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['targets', plural, id],
    queryFn: () => api<RecordRef[]>(`/objects/${plural}/${id}/targets`),
    enabled,
  });
}

/** Refreshes everything that shows notes, tasks and history. */
export function useRefreshActivity() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [['activities'], ['timeline'], ['targets'], ['records', 'notes'], ['records', 'tasks']].map(
        (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

/** Creates a note or task linked to records. */
export function useCreateActivity() {
  const refresh = useRefreshActivity();
  return useMutation({
    mutationFn: ({
      kind,
      values,
      targets,
    }: {
      kind: 'notes' | 'tasks';
      values: Record<string, unknown>;
      targets: { object: string; id: string }[];
    }) => send<RecordDto>('POST', `/objects/${kind}`, { ...values, targets }),
    onSuccess: refresh,
  });
}

export function useUpdateActivity() {
  const refresh = useRefreshActivity();
  return useMutation({
    mutationFn: ({ kind, id, values }: { kind: 'notes' | 'tasks'; id: string; values: object }) =>
      send<RecordDto>('PATCH', `/objects/${kind}/${id}`, values),
    onSuccess: refresh,
  });
}

export function useSetTargets(plural: string, id: string) {
  const refresh = useRefreshActivity();
  return useMutation({
    mutationFn: (targets: { object: string; id: string }[]) =>
      api<RecordRef[]>(`/objects/${plural}/${id}/targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets }),
      }),
    onSuccess: refresh,
  });
}

/** Records of any object matching the words (debounce `q` before passing it). */
export function useGlobalSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => api<SearchResultDto[]>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useDemoData() {
  return useQuery({
    queryKey: ['demo-data'],
    queryFn: () => api<{ loadedAt: string | null }>('/demo-data'),
  });
}

export function useLoadDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      send<{
        companies: number;
        people: number;
        opportunities: number;
        notes: number;
        tasks: number;
      }>('POST', '/demo-data'),
    onSettled: () => queryClient.invalidateQueries(),
  });
}
