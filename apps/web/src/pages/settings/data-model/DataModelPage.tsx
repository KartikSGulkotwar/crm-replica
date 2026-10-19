import type { ObjectMetadataDto } from '@crm-replica/shared';
import { ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ObjectIcon } from '../../../components/ObjectIcon';
import { Button, Card, FormError, Spinner } from '../../../components/ui';
import {
  useDestroyObject,
  useObjectsWithDeleted,
  useRestoreObject,
} from '../../../lib/metadata-mutations';
import { useIsAdmin } from '../../../lib/session';
import { useToast } from '../../../lib/toast';
import { NewObjectDialog } from './NewObjectDialog';

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'accent' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-raised text-muted'}`}
    >
      {children}
    </span>
  );
}

function ObjectRow({ object }: { object: ObjectMetadataDto }) {
  return (
    <li>
      <Link
        to={`/settings/data-model/${object.namePlural}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-raised"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-raised text-muted">
          <ObjectIcon name={object.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            {object.labelPlural}
            <Badge tone={object.isCustom ? 'accent' : 'muted'}>
              {object.isCustom ? 'Custom' : object.isSystem ? 'System' : 'Standard'}
            </Badge>
          </span>
          <span className="block truncate text-xs text-muted">
            {object.fields.length} field{object.fields.length === 1 ? '' : 's'}
            {object.description ? ` · ${object.description}` : ''}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 text-muted" />
      </Link>
    </li>
  );
}

export function DataModelPage() {
  const objects = useObjectsWithDeleted();
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const restore = useRestoreObject();
  const destroy = useDestroyObject();

  const live = objects.data?.filter((o) => !o.deletedAt) ?? [];
  const deleted = objects.data?.filter((o) => o.deletedAt) ?? [];

  return (
    <>
      <Card
        title="Objects"
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New object
            </Button>
          )
        }
      >
        {objects.isPending ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : objects.isError ? (
          <div className="p-4">
            <FormError error={objects.error} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {live.map((o) => (
              <ObjectRow key={o.id} object={o} />
            ))}
          </ul>
        )}
        {!isAdmin && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            Only admins can change the data model.
          </p>
        )}
      </Card>

      {deleted.length > 0 && (
        <Card title="Deleted objects">
          <p className="px-4 pt-3 text-xs text-muted">
            Their records are kept until you delete them permanently.
          </p>
          <ul className="divide-y divide-line">
            {deleted.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <ObjectIcon name={o.icon} className="size-4 text-muted" />
                <span className="flex-1 text-sm">{o.labelPlural}</span>
                {isAdmin && (
                  <>
                    <Button
                      variant="secondary"
                      loading={restore.isPending && restore.variables === o.id}
                      onClick={() =>
                        restore.mutate(o.id, { onError: (e) => toast(e.message, 'error') })
                      }
                    >
                      Restore
                    </Button>
                    <Button
                      variant="danger"
                      loading={destroy.isPending && destroy.variables === o.id}
                      onClick={() => {
                        if (
                          !confirm(
                            `Permanently delete ${o.labelPlural} and all of its records? This can’t be undone.`,
                          )
                        )
                          return;
                        destroy.mutate(o.id, {
                          onSuccess: () => toast(`${o.labelPlural} deleted permanently`),
                          onError: (e) => toast(e.message, 'error'),
                        });
                      }}
                    >
                      Delete permanently
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && <NewObjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}
