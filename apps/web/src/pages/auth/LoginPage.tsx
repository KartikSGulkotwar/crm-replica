import type { DemoLoginDto, SessionResponse } from '@crm-replica/shared';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, FormError, TextField } from '../../components/ui';
import { api, send } from '../../lib/api';
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
  // On the public demo server, the demo login is shown here for visitors.
  const demo = useQuery({
    queryKey: ['demo-login'],
    queryFn: () => api<DemoLoginDto>('/auth/demo'),
    staleTime: Infinity,
    retry: false,
  });
  const done = () => navigate(safeNext(params.get('next')), { replace: true });

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: done });
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
      {demo.data?.enabled && (
        <section
          aria-labelledby="demo-heading"
          className="mb-6 rounded-xl border border-accent/40 bg-accent-soft/50 p-4"
        >
          <h2 id="demo-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles aria-hidden className="size-4 text-accent" /> Try the demo
          </h2>
          <p className="mt-1 text-sm text-muted">
            A workspace full of sample companies, deals and tasks. Change anything: it’s rebuilt
            every night.
          </p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
            <dt className="text-muted">Email</dt>
            <dd className="break-all font-mono">{demo.data.email}</dd>
            <dt className="text-muted">Password</dt>
            <dd className="font-mono">{demo.data.password}</dd>
          </dl>
          <Button
            className="mt-3 w-full"
            loading={login.isPending && login.variables?.email === demo.data.email}
            onClick={() => {
              if (!demo.data?.enabled) return;
              login.mutate(
                { email: demo.data.email, password: demo.data.password },
                { onSuccess: done },
              );
            }}
          >
            Log in to the demo
          </Button>
        </section>
      )}
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
