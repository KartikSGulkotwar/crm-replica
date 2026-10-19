import type { FieldMetadataDto, ObjectMetadataDto } from '@crm-replica/shared';
import { FIELD_TYPE_INFO, FieldType } from '@crm-replica/shared';
import { ArrowLeft, ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FieldTypeIcon } from '../../../components/FieldTypeIcon';
import { ObjectIcon } from '../../../components/ObjectIcon';
import { Button, Card, FormError, FullPageSpinner, TextField } from '../../../components/ui';
import {
  useDeleteField,
  useDeleteObject,
  useDestroyField,
  useObjectsWithDeleted,
  useRestoreField,
  useUpdateObject,
} from '../../../lib/metadata-mutations';
import { useIsAdmin } from '../../../lib/session';
import { useToast } from '../../../lib/toast';
import { NotFoundPage } from '../../NotFoundPage';
import { FieldDialog } from './FieldDialog';
import { IconPicker } from './IconPicker';

const TITLE_TYPES: string[] = [FieldType.TEXT, FieldType.EMAIL, FieldType.PHONE, FieldType.LINK];

function AboutCard({ object, editable }: { object: ObjectMetadataDto; editable: boolean }) {
  const update = useUpdateObject();
  const toast = useToast();
  const [labelSingular, setLabelSingular] = useState(object.labelSingular);
  const [labelPlural, setLabelPlural] = useState(object.labelPlural);
  const [icon, setIcon] = useState(object.icon ?? 'box');
  const [description, setDescription] = useState(object.description ?? '');
  const [title, setTitle] = useState(object.labelIdentifierFieldName ?? '');
  const live = object.fields.filter((f) => !f.deletedAt);
  const dirty =
    labelSingular !== object.labelSingular ||
    labelPlural !== object.labelPlural ||
    icon !== (object.icon ?? 'box') ||
    description !== (object.description ?? '') ||
    title !== (object.labelIdentifierFieldName ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      {
        id: object.id,
        changes: {
          labelSingular: labelSingular.trim(),
          labelPlural: labelPlural.trim(),
          icon,
          description: description.trim() || null,
          ...(title ? { labelIdentifierFieldName: title } : {}),
        },
      },
      { onSuccess: () => toast('Saved') },
    );
  }

  return (
    <Card title="About">
      <form onSubmit={submit} className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name (singular)"
            value={labelSingular}
            disabled={!editable}
            onChange={(e) => setLabelSingular(e.target.value)}
          />
          <TextField
            label="Name (plural)"
            value={labelPlural}
            disabled={!editable}
            onChange={(e) => setLabelPlural(e.target.value)}
          />
        </div>
        <p className="-mt-2 text-xs text-muted">
          API names: <code className="font-mono">{object.nameSingular}</code> /{' '}
          <code className="font-mono">{object.namePlural}</code> (fixed)
        </p>
        {editable && (
          <div>
            <div className="mb-1 text-sm font-medium">Icon</div>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        )}
        <TextField
          label="Description"
          value={description}
          disabled={!editable}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Record title</span>
          <select
            aria-label="Record title"
            value={title}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm disabled:opacity-60"
          >
            {live
              .filter((f) => TITLE_TYPES.includes(f.type))
              .map((f) => (
                <option key={f.id} value={f.name}>
                  {f.label}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Shown as the record’s name in tables, links and pickers.
          </span>
        </label>
        <FormError error={update.error} />
        {editable && (
          <Button
            type="submit"
            disabled={!dirty || !labelSingular.trim() || !labelPlural.trim()}
            loading={update.isPending}
          >
            Save
          </Button>
        )}
      </form>
    </Card>
  );
}

function fieldDetail(field: FieldMetadataDto, objects: ObjectMetadataDto[]): string {
  if (field.relation) {
    const target = objects.find((o) => o.id === field.relation!.targetObjectId);
    return `→ ${target?.labelSingular ?? field.relation.targetObjectName}`;
  }
  if (field.options) return field.options.map((o) => o.label).join(', ');
  if (field.type === FieldType.RATING) return `${field.settings?.max ?? 5} stars`;
  if (field.type === FieldType.CURRENCY) return field.settings?.currency ?? 'USD';
  return '';
}

export function ObjectSettingsPage() {
  const { plural } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const objects = useObjectsWithDeleted();
  const [dialog, setDialog] = useState<{ field?: FieldMetadataDto } | null>(null);
  const deleteField = useDeleteField();
  const restoreField = useRestoreField();
  const destroyField = useDestroyField();
  const deleteObject = useDeleteObject();

  if (objects.isPending) return <FullPageSpinner />;
  const object = objects.data?.find((o) => o.namePlural === plural && !o.deletedAt);
  if (!object) return <NotFoundPage />;

  const editable = isAdmin && !object.isSystem;
  const live = object.fields.filter((f) => !f.deletedAt);
  const deleted = object.fields.filter((f) => f.deletedAt);
  const all = objects.data ?? [];
  const onError = (e: Error) => toast(e.message, 'error');

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/settings/data-model"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" /> Data model
          </Link>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <ObjectIcon name={object.icon} className="size-5 text-muted" />
            {object.labelPlural}
          </h2>
        </div>
        {!object.isSystem && (
          <Link
            to={`/objects/${object.namePlural}`}
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            Open {object.labelPlural.toLowerCase()} <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      <AboutCard
        key={
          object.id +
          object.labelSingular +
          object.labelPlural +
          (object.labelIdentifierFieldName ?? '')
        }
        object={object}
        editable={editable}
      />

      <Card
        title={`Fields (${live.length})`}
        actions={
          editable && (
            <Button onClick={() => setDialog({})}>
              <Plus aria-hidden className="size-4" /> Add field
            </Button>
          )
        }
      >
        <ul className="divide-y divide-line">
          {live.map((f) => {
            const isTitle = f.name === object.labelIdentifierFieldName;
            return (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                data-testid="field-row"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raised text-muted">
                  <FieldTypeIcon type={f.type} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {f.label}
                    {isTitle && (
                      <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">
                        Title
                      </span>
                    )}
                    {f.isRequired && (
                      <span className="rounded bg-raised px-1.5 text-[11px] text-muted">
                        Required
                      </span>
                    )}
                    {!f.isCustom && (
                      <span className="rounded bg-raised px-1.5 text-[11px] text-muted">
                        Standard
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    <code className="font-mono">{f.name}</code> · {FIELD_TYPE_INFO[f.type].label}
                    {fieldDetail(f, all) && ` · ${fieldDetail(f, all)}`}
                  </div>
                </div>
                {editable && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${f.label}`}
                      onClick={() => setDialog({ field: f })}
                      className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
                    {f.isCustom && !isTitle && (
                      <button
                        type="button"
                        aria-label={`Delete ${f.label}`}
                        onClick={() => {
                          if (
                            !confirm(
                              `Delete the field “${f.label}”? Its values are kept until you delete it permanently.`,
                            )
                          )
                            return;
                          deleteField.mutate(f.id, {
                            onSuccess: () => toast(`${f.label} deleted`),
                            onError,
                          });
                        }}
                        className="rounded p-1.5 text-muted hover:bg-raised hover:text-bad"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {object.isSystem && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            This is a system object; it’s managed automatically.
          </p>
        )}
      </Card>

      {deleted.length > 0 && (
        <Card title="Deleted fields">
          <ul className="divide-y divide-line">
            {deleted.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <FieldTypeIcon type={f.type} className="size-4 text-muted" />
                <span className="flex-1 text-sm">{f.label}</span>
                {editable && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        restoreField.mutate(f.id, {
                          onSuccess: () => toast(`${f.label} restored`),
                          onError,
                        })
                      }
                    >
                      Restore
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (
                          !confirm(
                            `Permanently delete “${f.label}” and its values in every record? This can’t be undone.`,
                          )
                        )
                          return;
                        destroyField.mutate(f.id, {
                          onSuccess: () => toast(`${f.label} deleted permanently`),
                          onError,
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

      {editable && object.isCustom && (
        <Card title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted">
              Deleting hides this object and its records. You can restore it from the Data model
              page.
            </p>
            <Button
              variant="danger"
              loading={deleteObject.isPending}
              onClick={() => {
                if (!confirm(`Delete ${object.labelPlural}?`)) return;
                deleteObject.mutate(object.id, {
                  onSuccess: () => {
                    toast(`${object.labelPlural} deleted`);
                    navigate('/settings/data-model');
                  },
                  onError,
                });
              }}
            >
              <Trash2 aria-hidden className="size-4" /> Delete object
            </Button>
          </div>
        </Card>
      )}

      {dialog && (
        <FieldDialog
          object={object}
          objects={all}
          field={dialog.field}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
