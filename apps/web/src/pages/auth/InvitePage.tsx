import type { InviteInfoResponse, SessionResponse } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, FormError, FullPageSpinner } from '../../components/ui';
import { api, send } from '../../lib/api';
import { useSession, useStartSession } from '../../lib/session';
import { AccountFields, AccountValues } from './AccountFields';
import { AuthLayout } from './AuthLayout';

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [account, setAccount] = useState<AccountValues>({ name: '', email: '', password: '' });
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteInfoResponse>(`/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const accept = useStartSession((body: AccountValues) =>
    send<SessionResponse>('POST', `/invites/${encodeURIComponent(token)}/accept`, body),
  );

  if (invite.isPending || session.isPending) return <FullPageSpinner />;

  if (invite.isError) {
    return (
      <AuthLayout title="Invite link not valid" subtitle={invite.error.message}>
        <p className="text-sm text-muted">Ask a workspace admin for a new link.</p>
        <Link
          to="/login"
          className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          Go to login
        </Link>
      </AuthLayout>
    );
  }

  if (session.data) {
    return (
      <AuthLayout
        title={`Join ${invite.data.workspaceName}`}
        subtitle={`You’re signed in as ${session.data.user.email} (${session.data.workspace.name}).`}
      >
        <p className="text-sm text-muted">
          Each account belongs to one workspace. Log out first, then open this link again to create
          an account in {invite.data.workspaceName}.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to your workspace
        </Link>
      </AuthLayout>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    accept.mutate(account, { onSuccess: () => navigate('/', { replace: true }) });
  }

  return (
    <AuthLayout
      title={`Join ${invite.data.workspaceName}`}
      subtitle="You’ve been invited. Create your account to get started."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AccountFields values={account} onChange={setAccount} />
        <FormError error={accept.error} />
        <Button type="submit" className="w-full" loading={accept.isPending}>
          Join workspace
        </Button>
      </form>
    </AuthLayout>
  );
}
