import {
  ArrowRight,
  Code,
  Database,
  Home,
  KeyRound,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  Workflow,
} from 'lucide-react';
import { KeyboardEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch } from '../lib/activities';
import { useObjects } from '../lib/metadata';
import { useIsAdmin } from '../lib/session';
import { useTheme } from '../lib/theme';
import { useDebounced } from '../lib/use-debounced';
import { ObjectIcon } from './ObjectIcon';
import { Spinner } from './ui';

interface Item {
  id: string;
  group: 'Records' | 'Go to' | 'Actions';
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

/**
 * ⌘K / Ctrl+K: jump to any record, object or page, or run a quick action. Records are searched
 * across every object on the server; pages and actions are filtered here.
 */
export function CommandPalette({ onClose, onAsk }: { onClose: () => void; onAsk: () => void }) {
  const navigate = useNavigate();
  const objects = useObjects().data ?? [];
  const isAdmin = useIsAdmin();
  const { choice, setChoice } = useTheme();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 150);
  const search = useGlobalSearch(debounced);
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  const go = (path: string) => () => navigate(path);
  const pages: Item[] = useMemo(() => {
    const dark =
      choice === 'dark' ||
      (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    return [
      {
        id: 'home',
        group: 'Go to',
        label: 'Home',
        icon: <Home className="size-4" />,
        run: go('/'),
      },
      ...objects
        .filter((o) => !o.isSystem)
        .map<Item>((o) => ({
          id: `object:${o.namePlural}`,
          group: 'Go to',
          label: o.labelPlural,
          icon: <ObjectIcon name={o.icon} className="size-4" />,
          run: go(`/objects/${o.namePlural}`),
        })),
      {
        id: 'workflows',
        group: 'Go to',
        label: 'Workflows',
        icon: <Workflow className="size-4" />,
        run: go('/workflows'),
      },
      {
        id: 'settings',
        group: 'Go to',
        label: 'Settings',
        icon: <Settings className="size-4" />,
        run: go('/settings/general'),
      },
      {
        id: 'members',
        group: 'Go to',
        label: 'Members',
        hint: 'Settings',
        icon: <Users className="size-4" />,
        run: go('/settings/members'),
      },
      ...(isAdmin
        ? [
            {
              id: 'data-model',
              group: 'Go to' as const,
              label: 'Data model',
              hint: 'Settings',
              icon: <Database className="size-4" />,
              run: go('/settings/data-model'),
            },
            {
              id: 'api-keys',
              group: 'Go to' as const,
              label: 'API keys',
              hint: 'Settings',
              icon: <KeyRound className="size-4" />,
              run: go('/settings/api-keys'),
            },
          ]
        : []),
      {
        id: 'docs',
        group: 'Go to',
        label: 'API docs',
        icon: <Code className="size-4" />,
        run: () => window.open('/api/docs', '_blank', 'noopener'),
      },
      {
        id: 'ask',
        group: 'Actions',
        label: 'Ask the CRM',
        hint: 'AI assistant',
        icon: <Sparkles className="size-4" />,
        run: onAsk,
      },
      {
        id: 'theme',
        group: 'Actions',
        label: dark ? 'Switch to light theme' : 'Switch to dark theme',
        icon: dark ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => setChoice(dark ? 'light' : 'dark'),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, isAdmin, choice]);

  const needle = q.trim().toLowerCase();
  const items: Item[] = [
    ...(needle && debounced.trim()
      ? (search.data ?? []).map<Item>((r) => ({
          id: `record:${r.object}:${r.id}`,
          group: 'Records',
          label: r.title,
          hint: [r.objectLabel, r.subtitle].filter(Boolean).join(' · '),
          icon: (
            <ObjectIcon
              name={objects.find((o) => o.nameSingular === r.object)?.icon}
              className="size-4"
            />
          ),
          run: go(r.url),
        }))
      : []),
    ...pages.filter((p) => !needle || `${p.label} ${p.hint ?? ''}`.toLowerCase().includes(needle)),
  ];

  useEffect(() => setActive(0), [q, search.data]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup: string | null = null;
  const searching = Boolean(needle) && (search.isFetching || q !== debounced);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-label="Search records, pages and actions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search records, pages and actions…"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted/70"
          />
          {searching && <Spinner className="size-3.5 text-muted" />}
          <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-muted sm:inline">
            Esc
          </kbd>
        </div>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="overflow-y-auto p-1.5"
        >
          {items.length === 0 && !searching && (
            <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>
          )}
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && (
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {header}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm ${
                    index === active ? 'bg-accent-soft text-accent' : ''
                  }`}
                >
                  <span className="shrink-0 text-muted">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{item.label}</span>
                    {item.hint && <span className="ml-2 text-xs text-muted">{item.hint}</span>}
                  </span>
                  {index === active && <ArrowRight aria-hidden className="size-4 shrink-0" />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
