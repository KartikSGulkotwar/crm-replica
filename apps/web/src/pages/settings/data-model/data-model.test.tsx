import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { pluralize } from '../../../lib/metadata-mutations';
import { adminSession, memberSession, mockApi, renderApp } from '../../../test-utils';

const field = (name: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: `f-${name}`,
  objectId: 'o-project',
  name,
  label,
  type,
  description: null,
  isCustom: true,
  isRequired: false,
  defaultValue: null,
  options: null,
  settings: null,
  relation: null,
  position: 0,
  deletedAt: null,
  ...extra,
});

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
  deletedAt: null,
  fields: [field('name', 'Name', 'TEXT', { isCustom: false })],
  inverseRelations: [],
};

const project = {
  ...company,
  id: 'o-project',
  nameSingular: 'project',
  namePlural: 'projects',
  labelSingular: 'Project',
  labelPlural: 'Projects',
  icon: 'folder',
  isCustom: true,
  fields: [
    field('name', 'Name', 'TEXT'),
    field('stage', 'Stage', 'SELECT', {
      options: [
        { value: 'PLANNED', label: 'Planned', color: 'gray', position: 0 },
        { value: 'ACTIVE', label: 'Active', color: 'blue', position: 1 },
      ],
    }),
    field('budget', 'Budget', 'CURRENCY', { settings: { currency: 'EUR' } }),
    field('legacyCode', 'Legacy code', 'TEXT', { deletedAt: '2026-01-01T00:00:00Z' }),
  ],
};

function routes(session = adminSession) {
  return {
    'GET /auth/me': { body: session },
    'GET /metadata/objects': { body: [company, project] },
  };
}

describe('Settings → Data model', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists objects with standard / custom badges', async () => {
    mockApi(routes());
    renderApp(<App />, { route: '/settings/data-model' });
    const card = (await screen.findByRole('heading', { name: 'Objects' })).closest('section')!;
    expect(await within(card).findByRole('link', { name: /Companies/ })).toHaveTextContent(
      'Standard',
    );
    expect(within(card).getByRole('link', { name: /Projects/ })).toHaveTextContent('Custom');
  });

  it('creates a custom object with derived plural and API names', async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...routes(),
      'POST /metadata/objects': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return {
          status: 201,
          body: {
            ...project,
            id: 'o-new',
            nameSingular: 'invoiceLine',
            namePlural: 'invoiceLines',
            labelPlural: 'Invoice lines',
          },
        };
      },
    });
    renderApp(<App />, { route: '/settings/data-model' });
    await userEvent.click(await screen.findByRole('button', { name: 'New object' }));
    const dialog = screen.getByRole('dialog', { name: 'New object' });
    await userEvent.type(within(dialog).getByLabelText('Name (singular)'), 'Invoice line');
    expect(within(dialog).getByLabelText('Name (plural)')).toHaveValue('Invoice lines');
    expect(within(dialog).getByLabelText('API name (plural)')).toHaveValue('invoiceLines');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'ticket' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create object' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          nameSingular: 'invoiceLine',
          namePlural: 'invoiceLines',
          labelSingular: 'Invoice line',
          labelPlural: 'Invoice lines',
          icon: 'ticket',
        },
      ]),
    );
  });

  it('adds a select field with options and colors', async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...routes(),
      'POST /metadata/objects/o-project/fields': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { status: 201, body: field('priority', 'Priority', 'SELECT') };
      },
    });
    renderApp(<App />, { route: '/settings/data-model/projects' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Priority');
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Select/ }));
    const first = within(dialog).getByLabelText('Option 1');
    await userEvent.clear(first);
    await userEvent.type(first, 'Low');
    await userEvent.clear(within(dialog).getByLabelText('Option 2'));
    await userEvent.type(within(dialog).getByLabelText('Option 2'), 'High');
    await userEvent.type(within(dialog).getByLabelText('New option'), 'Urgent{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Color for Urgent: yellow' }));
    await userEvent.click(screen.getByRole('radio', { name: 'red' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Default value'), 'LOW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create field' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          label: 'Priority',
          name: 'priority',
          type: 'SELECT',
          isRequired: false,
          options: [
            { label: 'Low', color: 'blue' },
            { label: 'High', color: 'green' },
            { label: 'Urgent', color: 'red' },
          ],
          defaultValue: 'LOW',
        },
      ]),
    );
  });

  it('adds a relation field pointing at another object', async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...routes(),
      'POST /metadata/objects/o-project/fields': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { status: 201, body: field('client', 'Client', 'RELATION') };
      },
    });
    renderApp(<App />, { route: '/settings/data-model/projects' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Client');
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Relation/ }));
    expect(within(dialog).getByLabelText('Links to')).toHaveValue('company');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create field' }));
    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        name: 'client',
        type: 'RELATION',
        relation: {
          targetObject: 'company',
          inverseName: 'projects',
          inverseLabel: 'Projects',
          onDelete: 'SET_NULL',
        },
      }),
    );
  });

  it('warns before removing an option that records may use', async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...routes(),
      'PATCH /metadata/fields/f-stage': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { body: project.fields[1] };
      },
    });
    renderApp(<App />, { route: '/settings/data-model/projects' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Stage' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Planned' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('will have it cleared');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        options: [{ label: 'Active', color: 'blue', value: 'ACTIVE' }],
      }),
    );
  });

  it('soft-deletes a field and offers restore for deleted ones', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls: string[] = [];
    mockApi({
      ...routes(),
      'DELETE /metadata/fields/f-budget': () => (
        calls.push('delete budget'),
        { body: project.fields[2] }
      ),
      'POST /metadata/fields/f-legacyCode/restore': () => (
        calls.push('restore legacy'),
        { body: project.fields[3] }
      ),
    });
    renderApp(<App />, { route: '/settings/data-model/projects' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Budget' }));
    expect(screen.queryByRole('button', { name: 'Delete Name' })).not.toBeInTheDocument(); // the title field
    const deletedCard = screen.getByText('Deleted fields').closest('section')!;
    await userEvent.click(within(deletedCard).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(calls).toEqual(['delete budget', 'restore legacy']));
  });

  it('is read-only for members', async () => {
    mockApi(routes(memberSession));
    renderApp(<App />, { route: '/settings/data-model' });
    expect(await screen.findByText('Only admins can change the data model.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New object' })).not.toBeInTheDocument();
  });
});

describe('pluralize', () => {
  it.each([
    ['Project', 'Projects'],
    ['Company', 'Companies'],
    ['Box', 'Boxes'],
    ['Day', 'Days'],
    ['Class', 'Classes'],
  ])('%s → %s', (word, plural) => expect(pluralize(word)).toBe(plural));
});
