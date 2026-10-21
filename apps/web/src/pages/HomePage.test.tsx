import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSession, memberSession, mockApi, renderApp } from '../test-utils';
import { HomePage } from './HomePage';

const health = {
  status: 'degraded',
  version: '0.1.0',
  uptimeSeconds: 1,
  checks: { database: 'up', redis: 'up', worker: 'down' },
};
const event = {
  id: 'e1',
  kind: 'updated',
  record: {
    object: 'opportunity',
    objectLabel: 'Opportunity',
    id: 'o1',
    title: 'Acme fleet',
    url: '/objects/opportunities/o1',
  },
  actor: null,
  source: 'workflow',
  sourceLabel: 'Won follow-up',
  changes: [
    {
      field: 'stage',
      label: 'Stage',
      before: 'NEW',
      after: 'WON',
      beforeText: 'New',
      afterText: 'Won',
    },
  ],
  activity: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const task = (id: string, title: string, dueDate: string | null) => ({
  id,
  title,
  dueDate,
  status: 'TO_DO',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const page = (data: unknown[]) => ({
  data,
  totalCount: data.length,
  pageInfo: { hasNextPage: false, endCursor: null },
});

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows recent activity, my open tasks and system status', async () => {
    const patched: unknown[] = [];
    const fetchMock = mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /health': { body: health },
      'GET /metadata/objects': { body: [] },
      'GET /demo-data': { body: { loadedAt: '2026-10-01T10:00:00Z' } },
      'GET /timeline': { body: { data: [event], nextCursor: null } },
      'GET /objects/tasks': {
        body: page([
          task('t1', 'Call Ada', '2020-01-01T10:00:00Z'),
          task('t2', 'Send proposal', null),
        ]),
      },
      'PATCH /objects/tasks/t1': (init) => {
        patched.push(JSON.parse(String(init?.body)));
        return { body: { ...task('t1', 'Call Ada', null), status: 'DONE' } };
      },
    });
    renderApp(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeInTheDocument();

    // Feed: who did what to which record, with readable values.
    const feed = (await screen.findByRole('heading', { name: 'Recent activity' })).closest(
      'section',
    )!;
    expect(await within(feed).findByText('Workflow “Won follow-up”')).toBeInTheDocument();
    expect(within(feed).getByRole('link', { name: 'Acme fleet' })).toHaveAttribute(
      'href',
      '/objects/opportunities/o1',
    );
    expect(within(feed).getByText('New')).toBeInTheDocument();
    expect(within(feed).getByText('Won')).toBeInTheDocument();
    expect(within(feed).getByText('5 minutes ago')).toBeInTheDocument();

    // My tasks: only open tasks assigned to me, overdue first.
    const tasksUrl = fetchMock.mock.calls
      .map(([input]) => new URL(String(input), 'http://x'))
      .find((u) => u.pathname === '/api/objects/tasks')!;
    expect(JSON.parse(tasksUrl.searchParams.get('filter')!)).toEqual({
      and: [
        { field: 'assignee', op: 'eq', value: 'u1' },
        { field: 'status', op: 'neq', value: 'DONE' },
      ],
    });
    expect(tasksUrl.searchParams.get('sort')).toBe('dueDate:asc');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Done: Call Ada' }));
    await waitFor(() => expect(patched).toEqual([{ status: 'DONE' }]));

    // Demo data was already added: no card on Home.
    expect(screen.queryByText('Add demo data')).toBeNull();
    expect(screen.getByTestId('status-Database')).toHaveTextContent('up');
    expect(screen.getByTestId('status-Worker')).toHaveTextContent('down');
  });

  it('offers admins demo data in an empty workspace', async () => {
    let loaded = false;
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /health': { body: health },
      'GET /metadata/objects': { body: [] },
      'GET /demo-data': () => ({ body: { loadedAt: loaded ? '2026-10-20T10:00:00Z' : null } }),
      'POST /demo-data': () => {
        loaded = true;
        return {
          status: 201,
          body: { companies: 30, people: 60, opportunities: 40, notes: 24, tasks: 30 },
        };
      },
      'GET /timeline': { body: { data: [], nextCursor: null } },
      'GET /objects/tasks': { body: page([]) },
    });
    renderApp(<HomePage />);
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(await screen.findByText('Nothing assigned to you. Nice.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Add demo data' }));
    expect(
      await screen.findByText('Added 30 companies, 60 people and 40 opportunities'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add demo data' })).toBeNull());
  });

  it('doesn’t offer demo data to members', async () => {
    mockApi({
      'GET /auth/me': { body: memberSession },
      'GET /health': { body: health },
      'GET /metadata/objects': { body: [] },
      'GET /timeline': { body: { data: [], nextCursor: null } },
      'GET /objects/tasks': { body: page([]) },
    });
    renderApp(<HomePage />);
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByText('Demo data')).toBeNull();
  });

  it('shows an error state when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderApp(<HomePage />);
    expect(await screen.findByText(/Can’t reach the API/)).toBeInTheDocument();
    expect(screen.getByTestId('status-API')).toHaveTextContent('down');
  });
});
