import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { safeNext } from './pages/auth/AuthLayout';
import { adminSession, memberSession, mockApi, renderApp } from './test-utils';

const health = {
  body: {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    checks: { database: 'up', redis: 'up', worker: 'up' },
  },
};
const members = {
  body: [
    {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Admin',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'u2',
      email: 'mo@example.com',
      name: 'Mo Member',
      role: 'member',
      createdAt: '2026-01-02T00:00:00Z',
    },
  ],
};

describe('App routing and auth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends logged-out visitors to the login page', async () => {
    mockApi({ 'GET /auth/me': { status: 401, body: { message: 'Please log in' } } });
    renderApp(<App />, { route: '/settings/members' });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the server error when login fails', async () => {
    mockApi({
      'GET /auth/me': { status: 401, body: { message: 'Please log in' } },
      'POST /auth/login': { status: 401, body: { message: 'Incorrect email or password' } },
    });
    renderApp(<App />, { route: '/login' });
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });

  it('logs in and returns to the page you asked for', async () => {
    let loggedIn = false;
    mockApi({
      'GET /auth/me': () => (loggedIn ? { body: adminSession } : { status: 401, body: {} }),
      'POST /auth/login': (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: 'ada@example.com',
          password: 'password123',
        });
        loggedIn = true;
        return { body: adminSession };
      },
      'GET /workspace/members': members,
      'GET /workspace/invite-link': { body: { token: 't', url: 'http://localhost:5173/invite/t' } },
    });
    renderApp(<App />, { route: '/login?next=%2Fsettings%2Fmembers' });
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByLabelText('Invite link')).toHaveValue(
      'http://localhost:5173/invite/t',
    );
  });

  it('gives admins the invite link and role controls', async () => {
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /health': health,
      'GET /workspace/members': members,
      'GET /workspace/invite-link': { body: { token: 't', url: 'http://localhost:5173/invite/t' } },
    });
    renderApp(<App />, { route: '/settings/members' });
    expect(await screen.findByLabelText('Role for Mo Member')).toHaveValue('member');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument(); // only for others, not yourself
    expect(await screen.findByLabelText('Invite link')).toBeInTheDocument();
  });

  it('shows members a read-only member list', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': { body: memberSession },
      'GET /workspace/members': members,
    });
    renderApp(<App />, { route: '/settings/members' });
    expect(
      await screen.findByText('Only admins can invite people or change roles.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Invite link')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
        '/api/workspace/invite-link',
      ),
    );
  });

  it('shows a friendly page for an invalid invite link', async () => {
    mockApi({
      'GET /auth/me': { status: 401, body: {} },
      'GET /invites/bad': {
        status: 404,
        body: { message: 'This invite link is invalid or has been reset' },
      },
    });
    renderApp(<App />, { route: '/invite/bad' });
    expect(
      await screen.findByRole('heading', { name: 'Invite link not valid' }),
    ).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it.each([
    ['/settings', '/settings'],
    [null, '/'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});
