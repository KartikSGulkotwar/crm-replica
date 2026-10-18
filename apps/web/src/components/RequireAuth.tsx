import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Button, FullPageSpinner } from './ui';

/** Renders child routes only when signed in; otherwise sends you to /login and back afterwards. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError) {
    return (
      <div className="grid h-full place-items-center p-4 text-center">
        <div>
          <p className="text-sm text-bad">Can’t reach the server: {session.error.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => session.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!session.data) {
    const next = location.pathname + location.search;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  return <Outlet />;
}

/** For /login and /signup: if you're already signed in, go straight to the app. */
export function RedirectIfAuthed() {
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (session.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
