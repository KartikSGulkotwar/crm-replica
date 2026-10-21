import { Home, Settings, Sparkles, Workflow } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useObjects } from '../lib/metadata';
import { useLogout, useSession } from '../lib/session';
import { AgentPanel } from './agent/AgentPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { ObjectIcon } from './ObjectIcon';
import { ThemeToggle } from './ThemeToggle';

function NavItem({
  to,
  label,
  icon,
  end,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${isActive ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-raised'}`
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function Brand() {
  const workspace = useSession().data?.workspace;
  return (
    <div className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-sm text-white">
        {(workspace?.name ?? 'C').slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate">{workspace?.name ?? 'CRM Replica'}</span>
    </div>
  );
}

function UserMenu() {
  const user = useSession().data?.user;
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted">
          {user.email} · <span className="capitalize">{user.role}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
      >
        Log out
      </button>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const objects = useObjects();
  const location = useLocation();
  const close = () => setOpen(false);
  const [askOpen, setAskOpen] = useState(false);
  const closeAsk = useCallback(() => setAskOpen(false), []);
  // Ctrl/⌘ + J opens and closes the assistant from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAskOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const askButton = (
    <button
      type="button"
      onClick={() => {
        close();
        setAskOpen((v) => !v);
      }}
      aria-expanded={askOpen}
      className="flex w-full items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm hover:border-accent hover:text-accent"
    >
      <Sparkles aria-hidden className="size-4 text-accent" />
      <span className="flex-1 text-left">Ask the CRM</span>
      <kbd className="hidden text-[10px] text-muted md:inline">⌘J</kbd>
    </button>
  );

  const sidebar = (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-3" aria-label="Main">
      <div className="mb-4 hidden px-2 pt-1 md:block">
        <Brand />
      </div>
      <div className="mb-2">{askButton}</div>
      <NavItem
        to="/"
        end
        label="Home"
        icon={<Home aria-hidden className="size-4" />}
        onNavigate={close}
      />
      <div className="mt-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        Objects
      </div>
      {objects.isPending && <div className="px-2 py-1.5 text-sm text-muted">Loading…</div>}
      {objects.isError && <div className="px-2 py-1.5 text-sm text-bad">Couldn’t load objects</div>}
      {objects.data
        ?.filter((o) => !o.isSystem)
        .map((o) => (
          <NavItem
            key={o.id}
            to={`/objects/${o.namePlural}`}
            label={o.labelPlural}
            icon={<ObjectIcon name={o.icon} />}
            onNavigate={close}
          />
        ))}
      <div className="mt-3 space-y-1">
        <NavItem
          to="/workflows"
          label="Workflows"
          icon={<Workflow aria-hidden className="size-4" />}
          onNavigate={close}
        />
        <NavItem
          to="/settings"
          label="Settings"
          icon={<Settings aria-hidden className="size-4" />}
          onNavigate={close}
        />
      </div>
      <div className="mt-auto space-y-2 border-t border-line px-1 pt-3">
        <UserMenu />
        <ThemeToggle />
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: top bar with a menu button. Desktop: fixed sidebar. */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            aria-label="Ask the CRM"
            className="rounded-lg p-1.5 text-accent hover:bg-raised"
          >
            <Sparkles aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="rounded-lg px-2 py-1 text-sm hover:bg-raised"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {open && (
        <div id="mobile-nav" className="border-b border-line bg-surface md:hidden">
          {sidebar}
        </div>
      )}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
        {sidebar}
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {askOpen && (
        <ErrorBoundary resetKey="agent">
          <AgentPanel onClose={closeAsk} />
        </ErrorBoundary>
      )}
    </div>
  );
}
