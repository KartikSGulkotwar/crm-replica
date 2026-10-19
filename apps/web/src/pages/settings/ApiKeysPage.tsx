import type { ApiKeyDto, CreatedApiKeyDto } from '@crm-replica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Button, Card, FormError, Spinner, TextField } from '../../components/ui';
import { api, send } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useIsAdmin } from '../../lib/session';
import { useToast } from '../../lib/toast';

const KEY = ['api-keys'];

function NewKey({ created, onDone }: { created: CreatedApiKeyDto; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="alert" className="space-y-3 border-b border-line bg-ok/5 p-4">
      <p className="text-sm font-medium">
        Key “{created.name}” created. Copy it now:{' '}
        <span className="text-bad">you won’t be able to see it again.</span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          aria-label="New API key"
          value={created.key}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs"
        />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(created.key);
            setCopied(true);
          }}
        >
          <Copy aria-hidden className="size-4" /> {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <p className="text-xs text-muted">
        Use it with the CLI: put <code className="font-mono">CRM_API_KEY={created.prefix}…</code> in
        your app’s <code className="font-mono">.env</code>, or send{' '}
        <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> to the REST API.
      </p>
    </div>
  );
}

/** Workspace API keys for the `crm` CLI and integrations. Admin-only. */
export function ApiKeysPage() {
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);
  const keys = useQuery({
    queryKey: KEY,
    queryFn: () => api<ApiKeyDto[]>('/api-keys'),
    enabled: isAdmin,
  });
  const create = useMutation({
    mutationFn: (keyName: string) => send<CreatedApiKeyDto>('POST', '/api-keys', { name: keyName }),
    onSuccess: (key) => {
      setCreated(key);
      setName('');
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => send<void>('DELETE', `/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  if (!isAdmin) {
    return (
      <Card title="API keys">
        <p className="p-4 text-sm text-muted">Only admins can create and see API keys.</p>
      </Card>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  return (
    <Card title="API keys">
      {created && <NewKey created={created} onDone={() => setCreated(null)} />}
      <form
        onSubmit={submit}
        className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-end"
      >
        <TextField
          label="New key name"
          placeholder="e.g. CLI on my laptop"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
          <KeyRound aria-hidden className="size-4" /> Create key
        </Button>
      </form>
      <div className="px-4 pt-3">
        <FormError error={create.error} />
      </div>
      {keys.isPending ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : keys.isError ? (
        <div className="p-4">
          <FormError error={keys.error} />
        </div>
      ) : keys.data.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          No API keys yet. Keys act as the admin who created them and can change the data model.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {keys.data.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{k.name}</div>
                <div className="truncate text-xs text-muted">
                  <code className="font-mono">{k.prefix}…</code> · created{' '}
                  {formatDateTime(k.createdAt)}
                  {k.createdBy ? ` by ${k.createdBy.name}` : ''} ·{' '}
                  {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'never used'}
                </div>
              </div>
              <Button
                variant="danger"
                aria-label={`Revoke ${k.name}`}
                loading={revoke.isPending && revoke.variables === k.id}
                onClick={() => {
                  if (!confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`))
                    return;
                  revoke.mutate(k.id, {
                    onSuccess: () => toast(`${k.name} revoked`),
                    onError: (e) => toast(e.message, 'error'),
                  });
                }}
              >
                <Trash2 aria-hidden className="size-4" /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
