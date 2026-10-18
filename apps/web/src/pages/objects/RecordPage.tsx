import type { InverseRelationDto, ObjectMetadataDto, RecordDto } from '@crm-replica/shared';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EditableField } from '../../components/fields/Field';
import { ObjectIcon } from '../../components/ObjectIcon';
import { Button, Card, FormError, FullPageSpinner } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { findObjectByName, orderedFields, useObject } from '../../lib/metadata';
import { recordLabel } from '../../lib/record-label';
import { relationExpands, useDeleteRecords, useRecord, useUpdateRecord } from '../../lib/records';
import { useToast } from '../../lib/toast';
import { NotFoundPage } from '../NotFoundPage';

function RelatedList({
  relation,
  records,
  objects,
}: {
  relation: InverseRelationDto;
  records: RecordDto[];
  objects: ObjectMetadataDto[];
}) {
  const source = findObjectByName(objects, relation.sourceObjectName);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ObjectIcon name={source?.icon} className="size-4 text-muted" />
          {relation.label}
          <span className="rounded-full bg-raised px-2 text-xs font-normal text-muted">
            {records.length}
          </span>
        </span>
      }
    >
      {records.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {records.map((r) => (
            <li key={r.id}>
              <Link
                to={`/objects/${source?.namePlural}/${r.id}`}
                className="block truncate px-4 py-2 text-sm hover:bg-raised"
              >
                {recordLabel(source, r)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RecordPage() {
  const { plural = '', id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { object, objects, isPending: metaPending } = useObject(plural);
  const expand = object
    ? [
        ...relationExpands(object),
        ...object.inverseRelations.slice(0, 5 - relationExpands(object).length).map((r) => r.name),
      ]
    : [];
  const record = useRecord(plural, id, expand);
  const update = useUpdateRecord(plural);
  const remove = useDeleteRecords(plural);

  if (metaPending || (object && record.isPending)) return <FullPageSpinner />;
  if (!object) return <NotFoundPage />;
  if (record.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link to={`/objects/${plural}`} className="text-sm text-accent hover:underline">
          ← {object.labelPlural}
        </Link>
        <div className="mt-4">
          <FormError error={record.error} />
        </div>
      </div>
    );
  }
  const data = record.data!;
  const [titleField, ...otherFields] = orderedFields(object);
  const readOnly = object.isSystem;
  const save = (values: Record<string, unknown>, optimistic?: Record<string, unknown>) =>
    update.mutate(
      { id, values, optimistic },
      { onError: (e) => toast(`Couldn’t save: ${(e as Error).message}`, 'error') },
    );
  const shownInverse = object.inverseRelations.filter((r) => Array.isArray(data[r.name]));

  function onDelete() {
    if (!confirm(`Delete this ${object!.labelSingular.toLowerCase()}?`)) return;
    remove.mutate([id], {
      onSuccess: () => {
        toast(`${object!.labelSingular} deleted`);
        navigate(`/objects/${plural}`);
      },
      onError: (e) => toast(`Couldn’t delete: ${(e as Error).message}`, 'error'),
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:py-8">
      <Link
        to={`/objects/${plural}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {object.labelPlural}
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <ObjectIcon name={object.icon} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="sr-only">{recordLabel(object, data)}</h1>
            {titleField && (
              <div className="text-xl font-semibold">
                <EditableField
                  field={titleField}
                  record={data}
                  objects={objects}
                  onSave={save}
                  readOnly={readOnly}
                />
              </div>
            )}
            <p className="text-xs text-muted">
              {object.labelSingular} · created {formatDateTime(data.createdAt)}
            </p>
          </div>
        </div>
        {!readOnly && (
          <Button variant="danger" onClick={onDelete} loading={remove.isPending}>
            <Trash2 aria-hidden className="size-4" />
            Delete
          </Button>
        )}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card title="Details">
          <dl className="divide-y divide-line">
            {otherFields.map((field) => (
              <div
                key={field.id}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-4 py-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]"
              >
                <dt className="truncate text-sm text-muted">{field.label}</dt>
                <dd className="min-w-0 text-sm">
                  <EditableField
                    field={field}
                    record={data}
                    objects={objects}
                    onSave={save}
                    readOnly={readOnly}
                  />
                </dd>
              </div>
            ))}
            {otherFields.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted">No other fields.</p>
            )}
          </dl>
        </Card>

        <div className="space-y-6">
          {shownInverse.map((relation) => (
            <RelatedList
              key={relation.name}
              relation={relation}
              records={data[relation.name] as RecordDto[]}
              objects={objects}
            />
          ))}
          {shownInverse.length === 0 && (
            <p className="text-sm text-muted">
              Nothing links to this {object.labelSingular.toLowerCase()} yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
