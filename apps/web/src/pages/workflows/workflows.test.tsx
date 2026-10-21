import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { adminSession, memberSession, mockApi, renderApp } from '../../test-utils';

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
  managedByApp: null,
  deletedAt: null,
  ...extra,
});
const object = (
  nameSingular: string,
  namePlural: string,
  labelSingular: string,
  labelPlural: string,
  fields: unknown[],
) => ({
  id: `o-${nameSingular}`,
  nameSingular,
  namePlural,
  labelSingular,
  labelPlural,
  description: null,
  icon: null,
  isCustom: false,
  isSystem: false,
  labelIdentifierFieldName: fields.length ? (fields[0] as { name: string }).name : null,
  position: 0,
  managedByApp: null,
  deletedAt: null,
  fields,
  inverseRelations: [],
});
const objects = [
  object('opportunity', 'opportunities', 'Opportunity', 'Opportunities', [
    field('name', 'Name', 'TEXT'),
    field('stage', 'Stage', 'SELECT', {
      options: [
        { value: 'NEW', label: 'New', color: 'gray', position: 0 },
        { value: 'WON', label: 'Won', color: 'green', position: 1 },
      ],
    }),
  ]),
  object('task', 'tasks', 'Task', 'Tasks', [
    field('title', 'Title', 'TEXT'),
    field('status', 'Status', 'SELECT', {
      options: [{ value: 'TO_DO', label: 'To do', color: 'gray', position: 0 }],
    }),
  ]),
];

const version = (n: number, status: string, definition: unknown) => ({
  id: `v${n}`,
  version: n,
  status,
  definition,
  createdAt: '2026-01-01T00:00:00Z',
  publishedAt: null,
});
const blank = { trigger: { type: 'MANUAL' }, steps: [] };
const workflow = (extra: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Won follow-up',
  description: null,
  isActive: false,
  managedByApp: null,
  activeVersion: null,
  draftVersion: version(1, 'DRAFT', blank),
  lastRun: null,
  nextRunAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const base = (session = adminSession) => ({
  'GET /auth/me': { body: session },
  'GET /metadata/objects': { body: objects },
});

describe('Workflows UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists workflows with their trigger and status', async () => {
    const won = {
      trigger: { type: 'RECORD_UPDATED', object: 'opportunity', fields: ['stage'] },
      steps: [],
    };
    mockApi({
      ...base(),
      'GET /workflows': {
        body: [
          workflow({
            isActive: true,
            activeVersion: version(1, 'ACTIVE', won),
            draftVersion: null,
            lastRun: { id: 'r1', status: 'SUCCEEDED', createdAt: '2026-01-02T00:00:00Z' },
          }),
        ],
      },
    });
    renderApp(<App />, { route: '/workflows' });
    const link = await screen.findByRole('link', { name: /Won follow-up/ });
    expect(link).toHaveTextContent('When a Opportunity is updated (stage)');
    expect(within(link).getByLabelText('Active')).toBeInTheDocument();
    expect(link).toHaveTextContent('succeeded');
  });

  it('builds a workflow: trigger, condition, a step with a variable, then saves the draft', async () => {
    const saved: unknown[] = [];
    mockApi({
      ...base(),
      'GET /workflows/w1': { body: workflow() },
      'PUT /workflows/w1/draft': (init) => {
        const body = JSON.parse(String(init?.body));
        saved.push(body.definition);
        return {
          body: {
            workflow: workflow({ draftVersion: version(1, 'DRAFT', body.definition) }),
            problems: [],
          },
        };
      },
    });
    renderApp(<App />, { route: '/workflows/w1' });
    await userEvent.selectOptions(await screen.findByLabelText('Trigger'), 'RECORD_UPDATED');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Object' }), 'opportunity');
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Fields that trigger' })).getByLabelText('Stage'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByLabelText('Condition 1 value'), '{{{{trigger.record.stage}}');
    await userEvent.type(screen.getByLabelText('Condition 1 compare to'), 'WON');

    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Create record/ }));
    await userEvent.click(screen.getByRole('button', { name: /Create record/, expanded: false }));
    await userEvent.selectOptions(screen.getByLabelText('Add a field'), 'title');
    await userEvent.type(screen.getByLabelText('Title'), 'Kick off ');
    // Insert a variable with the picker.
    const titleRow = screen.getByLabelText('Title').closest('div')!;
    await userEvent.click(within(titleRow).getByRole('button', { name: 'Insert variable' }));
    await userEvent.click(
      within(screen.getByRole('listbox', { name: 'Variables' })).getByRole('option', {
        name: /^Name\s*trigger\.record\.name$/,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(saved[0]).toEqual({
        trigger: {
          type: 'RECORD_UPDATED',
          object: 'opportunity',
          fields: ['stage'],
          when: {
            match: 'all',
            conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }],
          },
        },
        steps: [
          {
            id: 'create_record',
            name: 'Create record',
            type: 'CREATE_RECORD',
            object: 'task',
            values: { title: 'Kick off {{trigger.record.name}}' },
          },
        ],
      }),
    );
  });

  it('adds an AI step that classifies into a select field', async () => {
    const saved: unknown[] = [];
    mockApi({
      ...base(),
      'GET /workflows/w1': { body: workflow() },
      'PUT /workflows/w1/draft': (init) => {
        const body = JSON.parse(String(init?.body));
        saved.push(body.definition);
        return {
          body: {
            workflow: workflow({ draftVersion: version(1, 'DRAFT', body.definition) }),
            problems: [],
          },
        };
      },
    });
    renderApp(<App />, { route: '/workflows/w1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add step' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Ask AI/ }));
    await userEvent.click(screen.getByRole('button', { name: /Ask AI/, expanded: false }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Instructions' }),
      'Is this deal likely to close?',
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Save the answer to' }),
      'opportunity',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Field' }), 'stage');
    expect(screen.getByText(/Leave empty to choose from Stage’s options/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(saved[0]).toEqual({
        trigger: { type: 'MANUAL' },
        steps: [
          {
            id: 'ai',
            name: 'Ask AI',
            type: 'AI',
            prompt: 'Is this deal likely to close?',
            output: { object: 'opportunity', recordId: '{{trigger.record.id}}', field: 'stage' },
          },
        ],
      }),
    );
  });

  it('shows what blocks publishing', async () => {
    mockApi({
      ...base(),
      'GET /workflows/w1': { body: workflow() },
      'POST /workflows/w1/publish': { status: 400, body: { message: ['Add at least one step'] } },
    });
    renderApp(<App />, { route: '/workflows/w1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one step');
  });

  it('shows run history with each step’s input, output and errors', async () => {
    mockApi({
      ...base(),
      'GET /workflows/w1': { body: workflow() },
      'GET /workflows/w1/runs': {
        body: [
          {
            id: 'r1',
            workflowId: 'w1',
            workflowName: 'Won follow-up',
            versionId: 'v1',
            version: 1,
            status: 'FAILED',
            isTest: true,
            depth: 0,
            trigger: { type: 'MANUAL', occurredAt: '2026-01-01T00:00:00Z' },
            error: 'Email: Invalid recipient',
            createdAt: '2026-01-01T00:00:00Z',
            startedAt: '2026-01-01T00:00:00Z',
            finishedAt: '2026-01-01T00:00:01Z',
            steps: [
              {
                stepId: 'make_task',
                name: 'Create task',
                type: 'CREATE_RECORD',
                status: 'SUCCEEDED',
                attempts: 1,
                input: { values: { title: 'Hi' } },
                output: { id: 't1' },
                error: null,
                startedAt: null,
                finishedAt: null,
              },
              {
                stepId: 'mail',
                name: 'Email',
                type: 'SEND_EMAIL',
                status: 'FAILED',
                attempts: 3,
                input: { to: 'nope' },
                output: null,
                error: 'Invalid recipient',
                startedAt: null,
                finishedAt: null,
              },
            ],
          },
        ],
      },
    });
    renderApp(<App />, { route: '/workflows/w1' });
    await userEvent.click(await screen.findByRole('button', { name: 'runs' }));
    const run = await screen.findByRole('button', { name: /failed/ });
    expect(run).toHaveTextContent('test');
    await userEvent.click(run);
    const mail = screen.getByTestId('run-step-mail');
    expect(mail).toHaveTextContent('3 attempts');
    expect(mail).toHaveTextContent('Invalid recipient');
    expect(screen.getByTestId('run-step-make_task')).toHaveTextContent('"title": "Hi"');
  });

  it('is read-only for members', async () => {
    mockApi({ ...base(memberSession), 'GET /workflows/w1': { body: workflow() } });
    renderApp(<App />, { route: '/workflows/w1' });
    expect(await screen.findByText('Only admins can change workflows.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Trigger')).toBeDisabled();
  });
});
