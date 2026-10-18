import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { adminSession, mockApi, renderApp } from '../../test-utils';

const field = (name: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: `f-${name}`,
  objectId: 'o',
  name,
  label,
  type,
  description: null,
  isCustom: false,
  isRequired: false,
  defaultValue: null,
  options: null,
  settings: null,
  relation: null,
  position: 0,
  deletedAt: null,
  ...extra,
});

const companyObject = {
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
  fields: [
    field('name', 'Name', 'TEXT'),
    field('employees', 'Employees', 'NUMBER'),
    field('industry', 'Industry', 'SELECT', {
      options: [
        { value: 'SOFTWARE', label: 'Software', color: 'blue', position: 0 },
        { value: 'RETAIL', label: 'Retail', color: 'orange', position: 1 },
      ],
    }),
    field('isPartner', 'Partner', 'BOOLEAN'),
  ],
  inverseRelations: [
    {
      name: 'people',
      label: 'People',
      sourceObjectId: 'o-person',
      sourceObjectName: 'person',
      sourceFieldId: 'f-company',
      sourceFieldName: 'company',
    },
  ],
};

const personObject = {
  ...companyObject,
  id: 'o-person',
  nameSingular: 'person',
  namePlural: 'people',
  labelSingular: 'Person',
  labelPlural: 'People',
  icon: 'user',
  labelIdentifierFieldName: 'firstName',
  fields: [
    field('firstName', 'First name', 'TEXT'),
    field('lastName', 'Last name', 'TEXT'),
    field('company', 'Company', 'RELATION', {
      relation: {
        targetObjectId: 'o-company',
        targetObjectName: 'company',
        inverseName: 'people',
        inverseLabel: 'People',
        onDelete: 'SET_NULL',
      },
    }),
  ],
  inverseRelations: [],
};

const dealObject = {
  ...companyObject,
  id: 'o-deal',
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  isCustom: true,
  fields: [field('name', 'Name', 'TEXT')],
  inverseRelations: [],
};
const memberObject = {
  ...companyObject,
  id: 'o-m',
  nameSingular: 'workspaceMember',
  namePlural: 'workspaceMembers',
  labelPlural: 'Workspace members',
  isSystem: true,
  inverseRelations: [],
};

const record = (id: string, values: Record<string, unknown>) => ({
  id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: null,
  position: 1,
  ...values,
});

const acme = record('c1', { name: 'Acme', employees: 120, industry: 'SOFTWARE', isPartner: false });
const globex = record('c2', { name: 'Globex', employees: null, industry: null, isPartner: true });
const page = (data: unknown[], hasNextPage = false) => ({
  data,
  totalCount: data.length,
  pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next' : null },
});

function baseRoutes() {
  return {
    'GET /auth/me': { body: adminSession },
    'GET /metadata/objects': { body: [companyObject, personObject, dealObject, memberObject] },
    'GET /health': {
      body: { status: 'ok', checks: { database: 'up', redis: 'up', worker: 'up' } },
    },
  };
}

describe('Objects UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
      window.localStorage?.clear();
    } catch {
      // storage may be unavailable in this environment
    }
  });

  it('lists standard and custom objects in the sidebar, but not system ones', async () => {
    mockApi({ ...baseRoutes() });
    renderApp(<App />, { route: '/' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Companies' })).toHaveAttribute(
      'href',
      '/objects/companies',
    );
    expect(within(nav).getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    expect(within(nav).queryByText('Workspace members')).not.toBeInTheDocument();
  });

  it('shows records in a table with formatted values', async () => {
    mockApi({ ...baseRoutes(), 'GET /objects/companies': { body: page([acme, globex]) } });
    renderApp(<App />, { route: '/objects/companies' });
    expect(await screen.findByRole('heading', { name: 'Companies' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Acme')).toBeInTheDocument();
    expect(within(table).getByText('Software')).toBeInTheDocument();
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Employees/ })).toBeInTheDocument();
  });

  it('edits a text cell inline and sends only that field', async () => {
    const patch = vi.fn((_body: unknown) => undefined);
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies': { body: page([acme]) },
      'PATCH /objects/companies/c1': (init) => {
        patch(JSON.parse(String(init?.body)));
        return { body: { ...acme, name: 'Acme Corp' } };
      },
    });
    renderApp(<App />, { route: '/objects/companies' });
    await userEvent.click(await within(await screen.findByRole('table')).findByText('Acme'));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Acme Corp{Enter}');
    expect(await within(screen.getByRole('table')).findByText('Acme Corp')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith({ name: 'Acme Corp' });
  });

  it('picks a select option from the dropdown', async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies': { body: page([globex]) },
      'PATCH /objects/companies/c2': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { body: { ...globex, industry: 'RETAIL' } };
      },
    });
    renderApp(<App />, { route: '/objects/companies' });
    await screen.findByText('Globex');
    const industryCell = screen.getAllByRole('button', { name: 'Edit Industry' })[0];
    await userEvent.click(industryCell);
    await userEvent.click(
      within(screen.getByRole('listbox', { name: 'Industry' })).getByText('Retail'),
    );
    expect(bodies).toEqual([{ industry: 'RETAIL' }]);
    expect(await screen.findByText('Retail')).toBeInTheDocument();
  });

  it('rolls back and explains when the server rejects a value', async () => {
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies': { body: page([acme]) },
      'PATCH /objects/companies/c1': {
        status: 400,
        body: { message: ['employees must be a number'] },
      },
    });
    renderApp(<App />, { route: '/objects/companies' });
    await userEvent.click(await screen.findByText('120'));
    const input = screen.getByRole('spinbutton', { name: 'Employees' });
    await userEvent.clear(input);
    await userEvent.type(input, '5{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t save: employees must be a number',
    );
    expect(await screen.findByText('120')).toBeInTheDocument();
  });

  it('selects rows and deletes them in one request', async () => {
    const deleted: unknown[] = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies': { body: page([acme, globex]) },
      'POST /objects/companies/batch-delete': (init) => {
        deleted.push(JSON.parse(String(init?.body)));
        return { body: { deletedIds: ['c1', 'c2'] } };
      },
    });
    renderApp(<App />, { route: '/objects/companies' });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select all loaded rows' }));
    expect(screen.getByText('selected')).toHaveTextContent('2 selected');
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    await waitFor(() => expect(deleted).toEqual([{ ids: ['c1', 'c2'] }]));
    expect(await screen.findByText('Deleted 2 companies')).toBeInTheDocument();
  });

  it('shows an empty state with a create button', async () => {
    mockApi({ ...baseRoutes(), 'GET /objects/deals': { body: page([]) } });
    renderApp(<App />, { route: '/objects/deals' });
    expect(await screen.findByText('No deals yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New deal' }).length).toBeGreaterThan(0);
  });

  it('creates a record from the dialog, placed at the top', async () => {
    const created: unknown[] = [];
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies': { body: page([acme]) },
      'POST /objects/companies': (init) => {
        created.push(JSON.parse(String(init?.body)));
        return { status: 201, body: record('c9', { name: 'Initech' }) };
      },
    });
    renderApp(<App />, { route: '/objects/companies' });
    await userEvent.click(await screen.findByRole('button', { name: 'New company' }));
    const dialog = screen.getByRole('dialog', { name: 'New company' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit Name' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Initech{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created).toEqual([{ name: 'Initech', position: 0 }]));
    expect(await screen.findByText('Company created')).toBeInTheDocument();
  });

  it('shows a record page with its fields and related records', async () => {
    mockApi({
      ...baseRoutes(),
      'GET /objects/companies/c1': {
        body: {
          ...acme,
          people: [record('p1', { firstName: 'Ada', lastName: 'Lovelace', companyId: 'c1' })],
        },
      },
    });
    renderApp(<App />, { route: '/objects/companies/c1' });
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByText('Employees')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/objects/people/p1',
    );
  });

  it('links a related record with the relation picker', async () => {
    const bodies: unknown[] = [];
    // Behaves like the real API: PATCH returns plain fields; GET expands the relation.
    let ada: Record<string, unknown> = record('p1', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyId: null,
    });
    mockApi({
      ...baseRoutes(),
      'GET /objects/people/p1': () => ({
        body: { ...ada, company: ada.companyId === 'c2' ? globex : null },
      }),
      'GET /objects/companies': { body: page([acme, globex]) },
      'PATCH /objects/people/p1': (init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        ada = { ...ada, ...body };
        return { body: ada };
      },
    });
    renderApp(<App />, { route: '/objects/people/p1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Company' }));
    await userEvent.click(
      await within(screen.getByRole('listbox', { name: 'Company' })).findByText('Globex'),
    );
    expect(bodies).toEqual([{ companyId: 'c2' }]);
    expect(await screen.findByRole('link', { name: 'Globex' })).toHaveAttribute(
      'href',
      '/objects/companies/c2',
    );
  });
});
