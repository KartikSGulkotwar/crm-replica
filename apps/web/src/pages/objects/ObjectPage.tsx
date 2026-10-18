import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ObjectIcon } from '../../components/ObjectIcon';
import { Button, FormError, FullPageSpinner } from '../../components/ui';
import { useObject } from '../../lib/metadata';
import { relationExpands, useRecordsInfinite } from '../../lib/records';
import { useToast } from '../../lib/toast';
import { NotFoundPage } from '../NotFoundPage';
import { NewRecordDialog } from './NewRecordDialog';
import { RecordTable } from './RecordTable';

export function ObjectPage() {
  const { plural } = useParams();
  const { object, objects, isPending, error } = useObject(plural);
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const records = useRecordsInfinite(
    plural ?? '',
    { expand: object ? relationExpands(object) : [] },
    Boolean(object),
  );

  if (isPending) return <FullPageSpinner />;
  if (error)
    return (
      <div className="p-6">
        <FormError error={error} />
      </div>
    );
  if (!object) return <NotFoundPage />;

  const rows = records.data?.pages.flatMap((p) => p.data) ?? [];
  const total = records.data?.pages[0]?.totalCount;
  const firstPosition = rows[0]?.position ?? 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ObjectIcon name={object.icon} className="size-5 text-muted" />
          <h1 className="truncate text-lg font-semibold">{object.labelPlural}</h1>
          {total !== undefined && (
            <span className="rounded-full bg-raised px-2 text-xs text-muted">{total}</span>
          )}
        </div>
        {!object.isSystem && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            New {object.labelSingular.toLowerCase()}
          </Button>
        )}
      </header>

      {records.isPending ? (
        <FullPageSpinner />
      ) : records.isError ? (
        <div className="p-6">
          <FormError error={records.error} />
          <Button variant="secondary" className="mt-3" onClick={() => records.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div>
            <ObjectIcon name={object.icon} className="mx-auto size-10 text-muted/50" />
            <h2 className="mt-3 font-medium">No {object.labelPlural.toLowerCase()} yet</h2>
            <p className="mt-1 text-sm text-muted">Create the first one to get started.</p>
            {!object.isSystem && (
              <Button className="mt-4" onClick={() => setCreating(true)}>
                <Plus aria-hidden className="size-4" />
                New {object.labelSingular.toLowerCase()}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <RecordTable
          object={object}
          objects={objects}
          records={rows}
          hasNextPage={Boolean(records.hasNextPage)}
          isFetchingNextPage={records.isFetchingNextPage}
          fetchNextPage={() => void records.fetchNextPage()}
        />
      )}

      {creating && (
        <NewRecordDialog
          object={object}
          objects={objects}
          position={firstPosition - 1}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast(`${object.labelSingular} created`);
          }}
        />
      )}
    </div>
  );
}
