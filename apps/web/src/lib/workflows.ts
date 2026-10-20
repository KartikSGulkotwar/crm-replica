import type {
  SaveDraftResponse,
  WorkflowDefinition,
  WorkflowDto,
  WorkflowRunDto,
} from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send } from './api';

const KEY = ['workflows'];
const isRunning = (r: WorkflowRunDto) => ['QUEUED', 'RUNNING', 'WAITING'].includes(r.status);

export function useWorkflows() {
  return useQuery({ queryKey: KEY, queryFn: () => api<WorkflowDto[]>('/workflows') });
}

export function useWorkflow(id: string) {
  return useQuery({ queryKey: [...KEY, id], queryFn: () => api<WorkflowDto>(`/workflows/${id}`) });
}

/** Run history; refreshes every 1.5 s while a run is still going. */
export function useWorkflowRuns(id: string) {
  return useQuery({
    queryKey: [...KEY, id, 'runs'],
    queryFn: () => api<WorkflowRunDto[]>(`/workflows/${id}/runs?limit=50`),
    refetchInterval: (q) => (q.state.data?.some(isRunning) ? 1500 : false),
  });
}

function useWorkflowMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export const useCreateWorkflow = () =>
  useWorkflowMutation((input: { name: string; description?: string }) =>
    send<WorkflowDto>('POST', '/workflows', input),
  );
export const useRenameWorkflow = (id: string) =>
  useWorkflowMutation((input: { name?: string; description?: string | null }) =>
    send<WorkflowDto>('PATCH', `/workflows/${id}`, input),
  );
export const useSaveDraft = (id: string) =>
  useWorkflowMutation((definition: WorkflowDefinition) =>
    api<SaveDraftResponse>(`/workflows/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ definition }),
    }),
  );
export const usePublish = (id: string) =>
  useWorkflowMutation(() => send<WorkflowDto>('POST', `/workflows/${id}/publish`));
export const useDeactivate = (id: string) =>
  useWorkflowMutation(() => send<WorkflowDto>('POST', `/workflows/${id}/deactivate`));
export const useDiscardDraft = (id: string) =>
  useWorkflowMutation(() => send<WorkflowDto>('DELETE', `/workflows/${id}/draft`));
export const useDeleteWorkflow = (id: string) =>
  useWorkflowMutation(() => send<void>('DELETE', `/workflows/${id}`));
export const useTestRun = (id: string) =>
  useWorkflowMutation((recordId?: string) =>
    send<WorkflowRunDto>('POST', `/workflows/${id}/test`, recordId ? { recordId } : {}),
  );
export const useRunWorkflow = () =>
  useWorkflowMutation(({ id, recordId }: { id: string; recordId?: string }) =>
    send<WorkflowRunDto>('POST', `/workflows/${id}/run`, recordId ? { recordId } : {}),
  );
