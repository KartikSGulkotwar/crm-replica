import { InviteLinkResponse, MemberDto, WorkspaceRole } from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, FormError, Spinner } from '../../components/ui';
import { api, send } from '../../lib/api';
import { useIsAdmin, useSession } from '../../lib/session';

const MEMBERS_KEY = ['workspace', 'members'];
const INVITE_KEY = ['workspace', 'invite-link'];

function InviteLinkCard() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const link = useQuery({
    queryKey: INVITE_KEY,
    queryFn: () => api<InviteLinkResponse>('/workspace/invite-link'),
  });
  const reset = useMutation({
    mutationFn: () => send<InviteLinkResponse>('POST', '/workspace/invite-link/reset'),
    onSuccess: (data) => queryClient.setQueryData(INVITE_KEY, data),
  });

  async function copy() {
    if (!link.data) return;
    await navigator.clipboard.writeText(link.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card title="Invite link">
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Anyone with this link can join as a <strong className="text-ink">member</strong>. Reset it
          to stop the old link from working.
        </p>
        {link.isPending ? (
          <Spinner />
        ) : link.isError ? (
          <FormError error={link.error} />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label="Invite link"
              value={link.data.url}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2 font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                variant="danger"
                loading={reset.isPending}
                onClick={() => {
                  if (confirm('Reset the invite link? The current link will stop working.'))
                    reset.mutate();
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
        <FormError error={reset.error} />
      </div>
    </Card>
  );
}

function MemberRow({
  member,
  isAdmin,
  isSelf,
}: {
  member: MemberDto;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
  const changeRole = useMutation({
    mutationFn: (role: WorkspaceRole) =>
      send<MemberDto>('PATCH', `/workspace/members/${member.id}`, { role }),
    // Demoting yourself changes what you can see, so refresh the session too.
    onSuccess: () => (isSelf ? queryClient.invalidateQueries() : invalidate()),
  });
  const remove = useMutation({
    mutationFn: () => send<void>('DELETE', `/workspace/members/${member.id}`),
    onSuccess: invalidate,
  });

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-medium text-accent"
        >
          {member.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {member.name}{' '}
            {isSelf && (
              <span className="ml-1 rounded bg-raised px-1.5 text-xs text-muted">You</span>
            )}
          </div>
          <div className="truncate text-xs text-muted">{member.email}</div>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <select
              aria-label={`Role for ${member.name}`}
              value={member.role}
              disabled={changeRole.isPending}
              onChange={(e) => changeRole.mutate(e.target.value as WorkspaceRole)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            >
              <option value={WorkspaceRole.ADMIN}>Admin</option>
              <option value={WorkspaceRole.MEMBER}>Member</option>
            </select>
            {!isSelf && (
              <Button
                variant="ghost"
                className="text-bad"
                loading={remove.isPending}
                onClick={() => {
                  if (confirm(`Remove ${member.name} from the workspace?`)) remove.mutate();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ) : (
          <span className="text-sm capitalize text-muted">{member.role}</span>
        )}
      </div>
      <div className="mt-2 empty:hidden">
        <FormError error={changeRole.error ?? remove.error} />
      </div>
    </li>
  );
}

export function MembersSettingsPage() {
  const isAdmin = useIsAdmin();
  const me = useSession().data!.user;
  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => api<MemberDto[]>('/workspace/members'),
  });

  return (
    <>
      {isAdmin && <InviteLinkCard />}
      <Card title={`Members${members.data ? ` (${members.data.length})` : ''}`}>
        {members.isPending ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : members.isError ? (
          <div className="p-4">
            <FormError error={members.error} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {members.data.map((m) => (
              <MemberRow key={m.id} member={m} isAdmin={isAdmin} isSelf={m.id === me.id} />
            ))}
          </ul>
        )}
        {!isAdmin && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            Only admins can invite people or change roles.
          </p>
        )}
      </Card>
    </>
  );
}
