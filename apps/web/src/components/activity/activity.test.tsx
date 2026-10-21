import type { ObjectMetadataDto } from '@crm-replica/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSession, mockApi, renderApp } from '../../test-utils';
import { CommandPalette } from '../CommandPalette';
import { ActivityPanel } from './ActivityPanel';
import { LinkedRecords } from './LinkedRecords';

const company = {
  id: 'o-company',
  nameSingular: 'company',
  namePlural: 'companies',
  labelSingular: 'Company',
  labelPlural: 'Companies',
  description: null,
  icon: 'building',
  isCustom: false,
  isSystem: false,
  labelIdentifierFieldName: 'name',
  position: 0,
  managedByApp: null,
  deletedAt: null,
  fields: [
    {
      id: 'f-employees',
      objectId: 'o-company',
      name: 'employees',
      label: 'Employees',
      type: 'NUMBER',
      description: null,
      isCustom: false,
      isRequired: false,
      defaultValue: null,
      options: null,
      settings: null,
      relation: null,
      position: 0,
      managedByApp: null,
      deletedAt: null,
    },
  ],
  inverseRelations: [],
} as unknown as ObjectMetadataDto;
const noteObject = {
  ...company,
  id: 'o-note',
  nameSingular: 'note',
  namePlural: 'notes',
  labelSingular: 'Note',
  labelPlural: 'Notes',
};
const ref = (object: string, objectLabel: string, id: string, title: string, plural: string) => ({
  object,
  objectLabel,
  id,
  title,
  url: `/objects/${plural}/${id}`,
});
const acme = ref('company', 'Company', 'c1', 'Acme Robotics', 'companies');
const deal = ref('opportunity', 'Opportunity', 'o1', 'Acme fleet', 'opportunities');

function Where() {
  const location = useLocation();
  return <output aria-label="Current page">{location.pathname}</output>;
}

describe('ActivityPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the history, adds notes linked to the record, and adds and completes tasks', async () => {
    const created: unknown[] = [];
    const patched: unknown[] = [];
    let notes: unknown[] = [];
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /objects/companies/c1/timeline': (_, url) => ({
        body: url.searchParams.get('before')
          ? {
              data: [
                {
                  id: 'e0',
                  kind: 'created',
                  record: acme,
                  actor: { id: 'u1', name: 'Ada Admin' },
                  source: 'demo',
                  sourceLabel: null,
                  changes: [],
                  activity: null,
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
              nextCursor: null,
            }
          : {
              data: [
                {
                  id: 'e1',
                  kind: 'updated',
                  record: acme,
                  actor: { id: 'u1', name: 'Ada Admin' },
                  source: 'agent',
                  sourceLabel: null,
                  changes: [{ field: 'employees', label: 'Employees', before: null, after: 1200 }],
                  activity: null,
                  createdAt: new Date().toISOString(),
                },
              ],
              nextCursor: 'older',
            },
      }),
      'GET /objects/companies/c1/activities': () => ({
        body: {
          notes,
          tasks: [
            {
              record: {
                id: 't1',
                title: 'Send proposal',
                status: 'TO_DO',
                dueDate: '2020-01-01T10:00:00Z',
                createdAt: '2026-01-01T00:00:00Z',
              },
              targets: [acme, deal],
            },
          ],
        },
      }),
      'POST /objects/notes': (init) => {
        const body = JSON.parse(String(init?.body));
        created.push(body);
        notes = [
          { record: { id: 'n1', ...body, createdAt: new Date().toISOString() }, targets: [acme] },
        ];
        return { status: 201, body: { id: 'n1' } };
      },
      'POST /objects/tasks': (init) => {
        created.push(JSON.parse(String(init?.body)));
        return { status: 201, body: { id: 't2' } };
      },
      'PATCH /objects/tasks/t1': (init) => {
        patched.push(JSON.parse(String(init?.body)));
        return { body: { id: 't1' } };
      },
    });
    const user = userEvent.setup();
    renderApp(<ActivityPanel object={company} objects={[company]} id="c1" withNotesAndTasks />);

    // Timeline (default tab), with paging.
    expect(await screen.findByText('Ada Admin (via Ask the CRM)')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();

    // Open tasks are counted on the tab.
    expect(screen.getByRole('tab', { name: /Tasks\s*1/ })).toBeInTheDocument();

    // Notes.
    await user.click(screen.getByRole('tab', { name: /Notes/ }));
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Note title'), 'Call recap');
    await user.type(screen.getByLabelText('Note'), 'They want a pilot.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('link', { name: 'Call recap' })).toHaveAttribute(
      'href',
      '/objects/notes/n1',
    );
    expect(created[0]).toEqual({
      title: 'Call recap',
      body: 'They want a pilot.',
      targets: [{ object: 'company', id: 'c1' }],
    });

    // Tasks: overdue shown, other links shown, add one assigned to me, complete one.
    await user.click(screen.getByRole('tab', { name: /Tasks/ }));
    const row = (await screen.findByRole('link', { name: 'Send proposal' })).closest('li')!;
    expect(within(row).getByText(/Due/)).toHaveClass('text-bad');
    expect(within(row).getByRole('link', { name: 'Acme fleet' })).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Acme Robotics' })).toBeNull();
    await user.type(screen.getByLabelText('New task'), 'Book demo');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(created[1]).toEqual({
        title: 'Book demo',
        assigneeId: 'u1',
        targets: [{ object: 'company', id: 'c1' }],
      }),
    );
    await user.click(within(row).getByRole('checkbox', { name: 'Done: Send proposal' }));
    await waitFor(() => expect(patched).toEqual([{ status: 'DONE' }]));
  });

  it('links and unlinks records on a note page', async () => {
    let targets = [acme];
    const puts: unknown[] = [];
    mockApi({
      'GET /objects/notes/n1/targets': () => ({ body: targets }),
      'PUT /objects/notes/n1/targets': (init) => {
        const body = JSON.parse(String(init?.body));
        puts.push(body);
        targets = body.targets.map((t: { id: string }) => (t.id === 'c1' ? acme : deal));
        return { body: targets };
      },
      'GET /search': {
        body: [
          { ...deal, subtitle: null },
          { ...acme, subtitle: null },
        ],
      },
    });
    const user = userEvent.setup();
    renderApp(<LinkedRecords object={noteObject} id="n1" />);
    expect(await screen.findByRole('link', { name: 'Acme Robotics' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Link a record/ }));
    await user.type(screen.getByLabelText('Find a record to link'), 'acme');
    // Already-linked records aren't offered again.
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    await user.click(within(options[0]).getByRole('button', { name: /Acme fleet/ }));
    await waitFor(() =>
      expect(puts[0]).toEqual({
        targets: [
          { object: 'company', id: 'c1' },
          { object: 'opportunity', id: 'o1' },
        ],
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Unlink Acme Robotics' }));
    await waitFor(() =>
      expect(puts[1]).toEqual({ targets: [{ object: 'opportunity', id: 'o1' }] }),
    );
  });
});

describe('CommandPalette', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finds records and pages, and goes there with the keyboard', async () => {
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /metadata/objects': { body: [company] },
      'GET /search': (_, url) => ({
        body:
          url.searchParams.get('q') === 'acme' ? [{ ...acme, subtitle: 'acme.example.com' }] : [],
      }),
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderApp(
      <>
        <CommandPalette onClose={onClose} onAsk={() => {}} />
        <Where />
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Search records, pages and actions' });
    expect(input).toHaveFocus();
    // Pages and actions before typing.
    expect(await screen.findByRole('option', { name: /Companies/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ask the CRM/ })).toBeInTheDocument();

    await user.type(input, 'acme');
    const result = await screen.findByRole('option', { name: /Acme Robotics/ });
    expect(result).toHaveTextContent('Company · acme.example.com');
    expect(result).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByLabelText('Current page')).toHaveTextContent('/objects/companies/c1');
  });

  it('filters pages as you type and moves with the arrow keys', async () => {
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /metadata/objects': { body: [company] },
      'GET /search': { body: [] },
    });
    const user = userEvent.setup();
    renderApp(
      <>
        <CommandPalette onClose={() => {}} onAsk={() => {}} />
        <Where />
      </>,
    );
    await user.type(screen.getByRole('combobox'), 'settings');
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Settings',
        'MembersSettings',
        'Data modelSettings',
        'API keysSettings',
      ]),
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Current page')).toHaveTextContent('/settings/data-model');
  });
});
