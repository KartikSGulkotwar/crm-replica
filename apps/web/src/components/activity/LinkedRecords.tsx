import type { ObjectMetadataDto } from '@crm-replica/shared';
import { Link2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGlobalSearch, useSetTargets, useTargets } from '../../lib/activities';
import { useDebounced } from '../../lib/use-debounced';
import { useToast } from '../../lib/toast';
import { Popover } from '../Popover';
import { Card, FormError, Spinner } from '../ui';

/** On a note or task page: the records it's about, with add and remove. */
export function LinkedRecords({ object, id }: { object: ObjectMetadataDto; id: string }) {
  const targets = useTargets(object.namePlural, id, true);
  const setTargets = useSetTargets(object.namePlural, id);
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const results = useGlobalSearch(useDebounced(q));
  const button = useRef<HTMLButtonElement>(null);

  const current = targets.data ?? [];
  const save = (next: { object: string; id: string }[]) =>
    setTargets.mutate(next, {
      onError: (e) => toast(`Couldn’t update links: ${(e as Error).message}`, 'error'),
    });
  const linked = new Set(current.map((t) => `${t.object}:${t.id}`));
  const options = (results.data ?? []).filter(
    (r) => !linked.has(`${r.object}:${r.id}`) && r.object !== 'note' && r.object !== 'task',
  );

  return (
    <Card
      title="Linked to"
      actions={
        <button
          ref={button}
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          className="flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <Link2 aria-hidden className="size-4" /> Link a record
        </button>
      }
    >
      <div className="px-4 py-3">
        {targets.isPending && <Spinner />}
        {targets.isError && <FormError error={targets.error} />}
        {targets.data?.length === 0 && (
          <p className="text-sm text-muted">
            Not linked to anything. Link it to a company, person or deal to see it on their page.
          </p>
        )}
        <ul className="flex flex-wrap gap-1.5">
          {current.map((t) => (
            <li
              key={`${t.object}:${t.id}`}
              className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-2.5 pr-1 text-sm"
            >
              <span className="text-xs text-muted">{t.objectLabel}</span>
              <Link to={t.url} className="font-medium hover:text-accent">
                {t.title}
              </Link>
              <button
                type="button"
                aria-label={`Unlink ${t.title}`}
                disabled={setTargets.isPending}
                onClick={() =>
                  save(current.filter((x) => x !== t).map(({ object, id }) => ({ object, id })))
                }
                className="rounded-full p-0.5 text-muted hover:bg-raised hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {picking && (
        <Popover anchor={button} onClose={() => setPicking(false)} width={300}>
          <div className="p-2">
            <input
              autoFocus
              aria-label="Find a record to link"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search companies, people, deals…"
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <ul className="mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Records">
              {q.trim() && results.isFetching && !options.length && (
                <li className="px-2 py-1.5 text-sm text-muted">Searching…</li>
              )}
              {q.trim() && !results.isFetching && !options.length && (
                <li className="px-2 py-1.5 text-sm text-muted">No matches</li>
              )}
              {options.map((r) => (
                <li key={`${r.object}:${r.id}`} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => {
                      save([...current, r].map(({ object, id }) => ({ object, id })));
                      setPicking(false);
                      setQ('');
                    }}
                    className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-raised"
                  >
                    <span className="truncate font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted">{r.objectLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      )}
    </Card>
  );
}
