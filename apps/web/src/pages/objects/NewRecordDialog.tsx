import type { ObjectMetadataDto, RecordDto } from '@crm-replica/shared';
import { FormEvent, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { EditableField } from '../../components/fields/Field';
import { Button, FormError } from '../../components/ui';
import { orderedFields } from '../../lib/metadata';
import { useCreateRecord } from '../../lib/records';

/** Asks for the title and any required fields; everything else can be filled in the table. */
export function NewRecordDialog({
  object,
  objects,
  position,
  onClose,
  onCreated,
}: {
  object: ObjectMetadataDto;
  objects: ObjectMetadataDto[];
  /** Where the record goes in manual order (above the first row, so it shows at the top). */
  position: number;
  onClose: () => void;
  onCreated: (record: RecordDto) => void;
}) {
  const create = useCreateRecord(object.namePlural);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [display, setDisplay] = useState<Record<string, unknown>>({});
  const fields = orderedFields(object).filter((f, i) => i === 0 || f.isRequired);
  const draft = {
    id: 'new',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    position,
    ...values,
    ...display,
  } as RecordDto;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    create.mutate({ ...values, position }, { onSuccess: onCreated });
  }

  return (
    <Dialog
      title={`New ${object.labelSingular.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {fields.map((field) => (
          <div key={field.id}>
            <div className="mb-1 text-sm font-medium">
              {field.label}
              {field.isRequired && <span className="text-bad"> *</span>}
            </div>
            <div className="rounded-lg border border-line px-3 py-1.5">
              <EditableField
                field={field}
                record={draft}
                objects={objects}
                onSave={(v, optimistic) => {
                  setValues((prev) => ({ ...prev, ...v }));
                  if (optimistic) setDisplay((prev) => ({ ...prev, ...optimistic }));
                }}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">
          Click a value to edit it. You can fill in the other fields in the table.
        </p>
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}
