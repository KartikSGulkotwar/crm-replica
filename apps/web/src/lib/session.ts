import type { SessionResponse } from '@crm-replica/shared';
import { WorkspaceRole } from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, send } from './api';

export const SESSION_KEY = ['session'];

/** The signed-in user and workspace, or null when logged out. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionResponse | null> => {
      try {
        return await api<SessionResponse>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useIsAdmin() {
  return useSession().data?.user.role === WorkspaceRole.ADMIN;
}

/** For signup / login / accept-invite: on success, store the session and clear stale data. */
export function useStartSession<TInput>(request: (input: TInput) => Promise<SessionResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => send<void>('POST', '/auth/logout'),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
    },
  });
}
