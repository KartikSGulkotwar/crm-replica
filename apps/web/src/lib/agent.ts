import type {
  AgentConversationDto,
  AgentConversationSummary,
  AgentStatusDto,
  AgentStreamEvent,
} from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, send } from './api';

const KEY = ['agent'];
export const conversationKey = (id: string) => [...KEY, 'conversation', id];

export function useAgentStatus() {
  return useQuery({
    queryKey: [...KEY, 'status'],
    queryFn: () => api<AgentStatusDto>('/agent/status'),
    staleTime: 60_000,
  });
}

export function useConversations(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'conversations'],
    queryFn: () => api<AgentConversationSummary[]>('/agent/conversations'),
    enabled,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: conversationKey(id ?? ''),
    queryFn: () => api<AgentConversationDto>(`/agent/conversations/${id}`),
    enabled: Boolean(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => send<AgentConversationDto>('POST', '/agent/conversations'),
    onSuccess: (c) => {
      queryClient.setQueryData(conversationKey(c.id), c);
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'conversations'] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>('DELETE', `/agent/conversations/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: conversationKey(id) });
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'conversations'] });
    },
  });
}

/**
 * POSTs to a streaming endpoint and calls `onEvent` for each Server-Sent Event as it arrives.
 * Errors before the stream starts (validation, rate limit, not set up…) throw ApiError.
 */
export async function streamAgent(
  path: string,
  body: unknown,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => undefined)) as
      { message?: string | string[] } | undefined;
    const raw = json?.message;
    throw new ApiError(
      res.status,
      Array.isArray(raw) ? raw.join('. ') : (raw ?? `Request failed (${res.status})`),
      json,
    );
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) onEvent(JSON.parse(data) as AgentStreamEvent);
    }
  }
}
