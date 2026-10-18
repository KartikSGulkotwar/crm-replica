import type { SessionResponse } from '@crm-replica/shared';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, FormError, TextField } from '../../components/ui';
import { send } from '../../lib/api';
import { useStartSession } from '../../lib/session';
import { AccountFields, AccountValues } from './AccountFields';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const [account, setAccount] = useState<AccountValues>({ name: '', email: '', password: '' });
  const [workspaceName, setWorkspaceName] = useState('');
  const navigate = useNavigate();
  const signup = useStartSession((body: AccountValues & { workspaceName: string }) =>
    send<SessionResponse>('POST', '/auth/signup', body),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    signup.mutate(
      { ...account, workspaceName },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="You’ll be its admin. Invite your team afterwards."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Workspace name"
          placeholder="Acme Inc."
          autoComplete="organization"
          required
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
        />
        <AccountFields values={account} onChange={setAccount} />
        <FormError error={signup.error} />
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  );
}
