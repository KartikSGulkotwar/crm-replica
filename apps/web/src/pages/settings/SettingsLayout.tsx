import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/settings/general', label: 'General' },
  { to: '/settings/members', label: 'Members' },
];

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <nav className="mt-4 flex gap-1 border-b border-line" aria-label="Settings">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm ${
                isActive
                  ? 'border-accent font-medium text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 space-y-6">
        <Outlet />
      </div>
    </div>
  );
}
