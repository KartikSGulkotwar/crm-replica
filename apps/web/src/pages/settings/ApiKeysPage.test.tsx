import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { adminSession, memberSession, mockApi, renderApp } from '../../test-utils';

const existing = {
  id: 'k1',
  name: 'CI',
  prefix: 'crm_AbCd1234',
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  createdBy: { id: 'u1', name: 'Ada Admin' },
};

describe('Settings → API keys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a key and shows it exactly once', async () => {
    let keys = [existing];
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /metadata/objects': { body: [] },
      'GET /api-keys': () => ({ body: keys }),
      'POST /api-keys': (init) => {
        const created = {
          ...existing,
          id: 'k2',
          name: JSON.parse(String(init?.body)).name,
          prefix: 'crm_Zz998877',
          key: 'crm_Zz998877secretsecretsecretsecret',
        };
        keys = [created, ...keys];
        return { status: 201, body: created };
      },
    });
    renderApp(<App />, { route: '/settings/api-keys' });
    expect(await screen.findByText(/crm_AbCd1234…/)).toBeInTheDocument();
    expect(screen.getByText(/never used/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New key name'), 'My laptop');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByLabelText('New API key')).toHaveValue(
      'crm_Zz998877secretsecretsecretsecret',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('you won’t be able to see it again');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('New API key')).not.toBeInTheDocument();
    expect(screen.queryByText(/secretsecret/)).not.toBeInTheDocument();
  });

  it('revokes a key after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const revoked: string[] = [];
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /metadata/objects': { body: [] },
      'GET /api-keys': () => ({ body: revoked.length ? [] : [existing] }),
      'DELETE /api-keys/k1': () => (revoked.push('k1'), { status: 204 }),
    });
    renderApp(<App />, { route: '/settings/api-keys' });
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke CI' }));
    await waitFor(() => expect(revoked).toEqual(['k1']));
    expect(await screen.findByText(/No API keys yet/)).toBeInTheDocument();
  });

  it('is admin-only', async () => {
    mockApi({ 'GET /auth/me': { body: memberSession }, 'GET /metadata/objects': { body: [] } });
    renderApp(<App />, { route: '/settings/api-keys' });
    expect(await screen.findByText('Only admins can create and see API keys.')).toBeInTheDocument();
  });
});
