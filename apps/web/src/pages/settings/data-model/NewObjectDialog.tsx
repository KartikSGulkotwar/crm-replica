import { labelToApiName } from '@crm-replica/shared';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../../../components/Dialog';
import { Button, FormError, TextField } from '../../../components/ui';
import { pluralize, useCreateObject } from '../../../lib/metadata-mutations';
import { IconPicker } from './IconPicker';

/** Creates a custom object (with a "Name" field) and opens its settings to add more fields. */
export function NewObjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateObject();
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');
  const [pluralEdited, setPluralEdited] = useState(false);
  const [names, setNames] = useState<{ singular: string; plural: string } | null>(null);
  const [icon, setIcon] = useState('box');
  const [description, setDescription] = useState('');

  const labelPlural = pluralEdited ? plural : pluralize(singular);
  const apiSingular = names?.singular ?? labelToApiName(singular);
  const apiPlural = names?.plural ?? labelToApiName(labelPlural);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    create.mutate(
      {
        nameSingular: apiSingular,
        namePlural: apiPlural,
        labelSingular: singular.trim(),
        labelPlural: labelPlural.trim(),
        icon,
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: (object) => {
          onClose();
          navigate(`/settings/data-model/${object.namePlural}`);
        },
      },
    );
  }

  return (
    <Dialog
      title="New object"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => submit()}
            disabled={!singular.trim() || !labelPlural.trim()}
            loading={create.isPending}
          >
            Create object
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name (singular)"
            autoFocus
            placeholder="e.g. Project"
            value={singular}
            onChange={(e) => setSingular(e.target.value)}
          />
          <TextField
            label="Name (plural)"
            placeholder="e.g. Projects"
            value={labelPlural}
            onChange={(e) => {
              setPluralEdited(true);
              setPlural(e.target.value);
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="API name (singular)"
            value={apiSingular}
            onChange={(e) => setNames({ singular: e.target.value, plural: apiPlural })}
          />
          <TextField
            label="API name (plural)"
            value={apiPlural}
            onChange={(e) => setNames({ singular: apiSingular, plural: e.target.value })}
            hint={apiPlural ? `Records API: /api/objects/${apiPlural}` : undefined}
          />
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Icon</div>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-muted">
          The object starts with a “Name” field. You can add more next.
        </p>
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}
