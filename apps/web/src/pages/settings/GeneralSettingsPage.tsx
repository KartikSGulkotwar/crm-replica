import type { SessionResponse, WorkspaceSummary } from '@crm-replica/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { DemoDataCard } from '../../components/DemoDataCard';
import { Button, Card, FormError, TextField } from '../../components/ui';
import { send } from '../../lib/api';
import { SESSION_KEY, useIsAdmin, useSession } from '../../lib/session';

export function GeneralSettingsPage() {
  const session = useSession().data!;
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [name, setName] = useState(session.workspace.name);
  const rename = useMutation({
    mutationFn: (newName: string) =>
      send<WorkspaceSummary>('PATCH', '/workspace', { name: newName }),
    onSuccess: (workspace) =>
      queryClient.setQueryData<SessionResponse | null>(SESSION_KEY, (old) =>
        old ? { ...old, workspace } : old,
      ),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    rename.mutate(name);
  }

  return (
    <div className="space-y-6">
      <Card title="Workspace">
        <form onSubmit={submit} className="space-y-4 p-4">
          <TextField
            label="Workspace name"
            value={name}
            disabled={!isAdmin}
            onChange={(e) => setName(e.target.value)}
            hint={isAdmin ? undefined : 'Only admins can rename the workspace.'}
          />
          <FormError error={rename.error} />
          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                loading={rename.isPending}
                disabled={!name.trim() || name === session.workspace.name}
              >
                Save
              </Button>
              {rename.isSuccess && name === session.workspace.name && (
                <span className="text-sm text-ok">Saved</span>
              )}
            </div>
          )}
        </form>
      </Card>
      <DemoDataCard />
    </div>
  );
}
