import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

/** Placeholder navigation; Phase 5 replaces this with objects loaded from the data model. */
const NAV = [
  { to: '/', label: 'Home' },
  { to: '/objects/companies', label: 'Companies', soon: true },
  { to: '/objects/people', label: 'People', soon: true },
  { to: '/objects/opportunities', label: 'Opportunities', soon: true },
  { to: '/workflows', label: 'Workflows', soon: true },
  { to: '/settings', label: 'Settings', soon: true },
];

function Brand() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm text-white">
        C
      </span>
      CRM Replica
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-4 hidden px-2 pt-1 md:block">
        <Brand />
      </div>
      {NAV.map((item) =>
        item.soon ? (
          <span
            key={item.to}
            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-muted/70"
            title="Coming in a later phase"
          >
            {item.label}
            <span className="rounded bg-raised px-1.5 text-[10px] uppercase tracking-wide">
              soon
            </span>
          </span>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `rounded-lg px-2 py-1.5 text-sm ${isActive ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-raised'}`
            }
          >
            {item.label}
          </NavLink>
        ),
      )}
      <div className="mt-auto px-1">
        <ThemeToggle />
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: top bar with a menu button. Desktop: fixed sidebar. */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg px-2 py-1 text-sm hover:bg-raised"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="border-b border-line bg-surface md:hidden">
          {sidebar}
        </div>
      )}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
        {sidebar}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
