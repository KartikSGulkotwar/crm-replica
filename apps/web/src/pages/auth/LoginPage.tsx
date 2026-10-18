import type { SessionResponse } from '@crm-replica/shared';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, FormError, TextField } from '../../components/ui';
import { send } from '../../lib/api';
import { useStartSession } from '../../lib/session';
import { AuthLayout, safeNext } from './AuthLayout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useStartSession((body: { email: string; password: string }) =>
    send<SessionResponse>('POST', '/auth/login', body),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }) },
    );
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            Create a workspace
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError error={login.error} />
        <Button type="submit" className="w-full" loading={login.isPending}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
