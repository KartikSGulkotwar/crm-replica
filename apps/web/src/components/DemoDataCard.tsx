import { Database } from 'lucide-react';
import { useDemoData, useLoadDemoData } from '../lib/activities';
import { formatDateTime } from '../lib/format';
import { useIsAdmin } from '../lib/session';
import { useToast } from '../lib/toast';
import { Button, FormError } from './ui';

/**
 * Offers admins a ready-made pipeline to explore: 30 companies, 60 people, 40 opportunities,
 * with notes and tasks. It can be added once per workspace.
 */
export function DemoDataCard({ hideWhenLoaded = false }: { hideWhenLoaded?: boolean }) {
  const isAdmin = useIsAdmin();
  const status = useDemoData();
  const load = useLoadDemoData();
  const toast = useToast();
  if (!isAdmin || status.isPending || status.isError) return null;
  const loadedAt = status.data.loadedAt;
  if (loadedAt && hideWhenLoaded) return null;

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Database aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Demo data</h2>
          {loadedAt ? (
            <p className="mt-0.5 text-sm text-muted">Added {formatDateTime(loadedAt)}.</p>
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              Fill this workspace with a made-up sales pipeline: 30 companies, 60 people and 40
              opportunities, with notes and tasks. It doesn’t trigger workflows. You can only add it
              once.
            </p>
          )}
          <FormError error={load.error} />
        </div>
        {!loadedAt && (
          <Button
            variant="secondary"
            loading={load.isPending}
            onClick={() =>
              load.mutate(undefined, {
                onSuccess: (r) =>
                  toast(
                    `Added ${r.companies} companies, ${r.people} people and ${r.opportunities} opportunities`,
                  ),
              })
            }
          >
            Add demo data
          </Button>
        )}
      </div>
    </section>
  );
}
