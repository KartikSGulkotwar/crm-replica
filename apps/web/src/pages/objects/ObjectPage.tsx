import { ViewType } from '@crm-replica/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ObjectIcon } from '../../components/ObjectIcon';
import { Button, FormError, FullPageSpinner } from '../../components/ui';
import { useObject } from '../../lib/metadata';
import { relationExpands, useRecordsInfinite } from '../../lib/records';
import { useToast } from '../../lib/toast';
import { useUpdateView, useViews, viewFilter, viewSort } from '../../lib/views';
import { NotFoundPage } from '../NotFoundPage';
import { KanbanBoard } from './KanbanBoard';
import { NewRecordDialog } from './NewRecordDialog';
import { RecordTable } from './RecordTable';
import { ViewBar } from './ViewBar';

export function ObjectPage() {
  const { plural } = useParams();
  const [params, setParams] = useSearchParams();
  const { object, objects, isPending, error } = useObject(plural);
  const views = useViews(object ? plural : undefined);
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  // The selected view lives in the URL (?view=…), so it survives reloads and can be shared.
  const view =
    views.data?.find((v) => v.id === params.get('view')) ?? views.data?.find((v) => v.isDefault);
  const isTable = view?.type !== ViewType.KANBAN;
  const records = useRecordsInfinite(
    plural ?? '',
    {
      filter: viewFilter(view),
      sort: viewSort(view),
      expand: object ? relationExpands(object) : [],
    },
    Boolean(object && view && isTable),
  );
  const updateView = useUpdateView(plural ?? '');

  if (isPending || (object && views.isPending)) return <FullPageSpinner />;
  if (error || views.error)
    return (
      <div className="p-6">
        <FormError error={error ?? views.error} />
      </div>
    );
  if (!object || !view) return <NotFoundPage />;

  const rows = records.data?.pages.flatMap((p) => p.data) ?? [];
  const total = records.data?.pages[0]?.totalCount;
  const filtered = view.filters.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ObjectIcon name={object.icon} className="size-5 text-muted" />
          <h1 className="truncate text-lg font-semibold">{object.labelPlural}</h1>
          {isTable && total !== undefined && (
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

      <ViewBar
        key={view.id}
        object={object}
        objects={objects}
        views={views.data!}
        view={view}
        onSelectView={(id) =>
          setParams(id === views.data!.find((v) => v.isDefault)?.id ? {} : { view: id })
        }
      />

      {!isTable ? (
        <KanbanBoard object={object} objects={objects} view={view} />
      ) : records.isPending ? (
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
            {filtered ? (
              <>
                <h2 className="mt-3 font-medium">
                  No {object.labelPlural.toLowerCase()} match these filters
                </h2>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => updateView.mutate({ id: view.id, changes: { filters: [] } })}
                >
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <h2 className="mt-3 font-medium">No {object.labelPlural.toLowerCase()} yet</h2>
                <p className="mt-1 text-sm text-muted">Create the first one to get started.</p>
                {!object.isSystem && (
                  <Button className="mt-4" onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" />
                    New {object.labelSingular.toLowerCase()}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <RecordTable
          object={object}
          objects={objects}
          view={view}
          onSaveFields={(fields) =>
            updateView.mutate(
              {
                id: view.id,
                changes: {
                  fields: fields.map(({ fieldName, isVisible, width }) => ({
                    fieldName,
                    isVisible,
                    width,
                  })),
                },
              },
              { onError: (e) => toast(`Couldn’t save layout: ${e.message}`, 'error') },
            )
          }
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
          position={(rows[0]?.position ?? 1) - 1}
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
