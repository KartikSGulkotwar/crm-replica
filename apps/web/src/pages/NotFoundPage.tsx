import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">This page doesn’t exist, or isn’t built yet.</p>
      <Link to="/" className="mt-6 inline-block text-sm text-accent hover:underline">
        Back to home
      </Link>
    </div>
  );
}
