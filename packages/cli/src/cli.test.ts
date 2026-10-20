import {
  FieldMetadataDto,
  FieldType,
  ObjectMetadataDto,
  planApp,
  ViewDto,
  ViewType,
  WorkflowDto,
  workflowDefinitionSchema,
} from '@crm-replica/shared';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fileSlug, objectSource, viewSource, workflowSource } from './codegen';
import { CliError, loadConfig } from './config';
import { loadApp, ValidationError } from './load';
import { formatPlan } from './output';

const root = join(__dirname, '..');
const example = join(root, '..', '..', 'examples', 'sales-app');
const tmp = join(root, '.tmp-test');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('loading apps', () => {
  it('loads examples/sales-app', async () => {
    const { manifest } = await loadApp(loadConfig(example, { apiKey: 'x' }));
    expect(manifest.name).toBe('sales-app');
    expect(manifest.objects.map((o) => o.nameSingular)).toEqual(['deal']);
    expect(manifest.views.map((v) => v.name).sort()).toEqual(['Big deals', 'Deal pipeline']);
    expect(manifest.workflows.map((w) => w.name)).toEqual(['Opportunity won: kickoff']);
  });

  it('reports problems with the file they come from', async () => {
    const error = await loadApp(loadConfig(join(root, 'test-fixtures', 'bad-app'))).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).problems).toEqual([
      'objects/ticket.ts: fields.0.options: Add at least one option',
    ]);
    // Object-level checks run once the fields are valid.
    const dir = join(tmp, 'plural-app');
    mkdirSync(join(dir, 'objects'), { recursive: true });
    writeFileSync(join(dir, 'crm.json'), JSON.stringify({ name: 'plural-app' }));
    writeFileSync(
      join(dir, 'objects', 'ticket.ts'),
      "export default { nameSingular: 'ticket', namePlural: 'ticket', labelSingular: 'T', labelPlural: 'Ts', fields: [] };",
    );
    const second = (await loadApp(loadConfig(dir)).catch((e) => e)) as ValidationError;
    expect(second.problems).toEqual([
      'objects/ticket.ts: namePlural: Plural name must differ from the singular',
    ]);
  });

  it('explains a missing or invalid crm.json', () => {
    expect(() => loadConfig(tmp)).toThrow(CliError);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'crm.json'), JSON.stringify({ name: 'Bad Name' }));
    expect(() => loadConfig(tmp)).toThrow('lowercase letters');
  });

  it('takes the URL from flags, then env, then crm.json', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, 'crm.json'),
      JSON.stringify({ name: 'ok-app', url: 'http://from-file:1/' }),
    );
    expect(loadConfig(tmp).url).toBe('http://from-file:1');
    process.env.CRM_URL = 'http://from-env:2';
    expect(loadConfig(tmp).url).toBe('http://from-env:2');
    expect(loadConfig(tmp, { url: 'http://flag:3' }).url).toBe('http://flag:3');
    delete process.env.CRM_URL;
  });
});

// A workspace as the server returns it (what `crm pull` reads).
const field = (
  name: string,
  label: string,
  type: FieldType,
  extra: Partial<FieldMetadataDto> = {},
): FieldMetadataDto => ({
  id: `f-${name}`,
  objectId: 'o-deal',
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
  managedByApp: null,
  deletedAt: null,
  ...extra,
});
const company: ObjectMetadataDto = {
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
    field('name', 'Name', FieldType.TEXT, { isCustom: false }),
    field('tier', 'Tier', FieldType.RATING, { settings: { max: 3 } }),
  ],
  inverseRelations: [],
};
const deal: ObjectMetadataDto = {
  ...company,
  id: 'o-deal',
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  icon: 'handshake',
  description: "It's a deal",
  isCustom: true,
  fields: [
    field('name', 'Name', FieldType.TEXT, { isRequired: true }),
    field('amount', 'Amount', FieldType.CURRENCY, { settings: { currency: 'EUR' } }),
    field('stage', 'Stage', FieldType.SELECT, {
      options: [
        { value: 'LEAD', label: 'Lead', color: 'gray', position: 0 },
        { value: 'CLOSED_WON', label: 'Won', color: 'green', position: 1 },
      ],
      defaultValue: 'LEAD',
    }),
    field('company', 'Company', FieldType.RELATION, {
      relation: {
        targetObjectId: 'o-company',
        targetObjectName: 'company',
        inverseName: 'deals',
        inverseLabel: 'Deals',
        onDelete: 'CASCADE',
      },
    }),
    field('legacy', 'Legacy', FieldType.TEXT, { deletedAt: '2026-01-01T00:00:00Z' }),
  ],
};
const pipeline: ViewDto = {
  id: 'v1',
  objectId: 'o-deal',
  objectName: 'deal',
  name: 'Deal pipeline',
  type: ViewType.KANBAN,
  isDefault: false,
  kanbanFieldName: 'stage',
  filterConjunction: 'or',
  position: 1,
  managedByApp: null,
  fields: [
    { fieldName: 'name', isVisible: true, width: 240, position: 0 },
    { fieldName: 'amount', isVisible: true, width: null, position: 1 },
    { fieldName: 'stage', isVisible: false, width: null, position: 2 },
  ],
  filters: [{ fieldName: 'amount', operator: 'gte', value: 1000 }],
  sorts: [{ fieldName: 'amount', direction: 'desc' }],
};

describe('crm pull code generation', () => {
  it('writes code that plans to zero changes against the workspace it came from', async () => {
    const dir = join(tmp, 'pulled');
    mkdirSync(join(dir, 'objects'), { recursive: true });
    mkdirSync(join(dir, 'views'), { recursive: true });
    writeFileSync(join(dir, 'crm.json'), JSON.stringify({ name: 'pulled-app' }));
    writeFileSync(join(dir, 'objects', 'deal.ts'), objectSource(deal));
    writeFileSync(join(dir, 'objects', 'company.ts'), objectSource(company));
    writeFileSync(
      join(dir, 'views', `${fileSlug('deal-Deal pipeline')}.ts`),
      viewSource(pipeline, 'deals'),
    );

    const { manifest } = await loadApp(loadConfig(dir));
    // Only the adoption of the custom object and fields remains (they'd become managed by the app).
    const plan = planApp(manifest, { objects: [company, deal], views: [pipeline] });
    expect(plan.errors).toEqual([]);
    for (const change of plan.changes) {
      expect(change.details.filter((d) => !/managed by this app/.test(d))).toEqual([]);
    }
  });

  it('produces readable source', () => {
    const source = objectSource(deal);
    expect(source).toContain("import { defineObject, FieldType } from '@crm-replica/sdk';");
    expect(source).toContain(
      "{ name: 'amount', label: 'Amount', type: FieldType.CURRENCY, settings: { currency: 'EUR' } }",
    );
    expect(source).toContain("{ label: 'Won', value: 'CLOSED_WON', color: 'green' }"); // value kept when it differs from the label
    expect(source).toContain("description: 'It\\'s a deal'");
    expect(source).not.toContain('legacy'); // deleted fields are left out
    expect(objectSource(company)).not.toContain("name: 'name'"); // standard fields aren't managed by apps
    expect(fileSlug('deal-Big deals!')).toBe('deal-big-deals');
  });
});

describe('formatPlan', () => {
  it('summarises a plan', () => {
    const out = formatPlan({
      app: 'sales-app',
      dryRun: true,
      applied: false,
      errors: [],
      changes: [
        {
          kind: 'createObject',
          object: 'deal',
          summary: 'Create object deal (Deals) with 4 fields',
          details: ['+ name (TEXT)'],
          destructive: false,
        },
        {
          kind: 'removeField',
          object: 'deal',
          field: 'x',
          summary: 'Remove field deal.x; its values are deleted',
          details: [],
          destructive: true,
        },
      ],
    });
    expect(out).toContain('+ Create object deal (Deals) with 4 fields');
    expect(out).toContain('- Remove field deal.x; its values are deleted [destructive]');
    expect(out).toContain('1 to create, 0 to update, 1 to remove (1 destructive)');
  });
});

describe('crm pull: workflows', () => {
  it('writes workflows that plan to zero changes against the workspace', async () => {
    const definition = workflowDefinitionSchema.parse({
      trigger: {
        type: 'RECORD_UPDATED',
        object: 'deal',
        fields: ['stage'],
        when: { conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }] },
      },
      steps: [
        {
          id: 'task',
          name: 'Create task',
          type: 'CREATE_RECORD',
          object: 'task',
          values: { title: "Kick off {{trigger.record.name}}'s deal" },
        },
        {
          id: 'big',
          name: 'Big?',
          type: 'IF_ELSE',
          condition: {
            conditions: [{ left: '{{trigger.record.amount.amount}}', op: 'gte', right: '100000' }],
          },
          then: [
            {
              id: 'mail',
              name: 'Email',
              type: 'SEND_EMAIL',
              to: 'a@example.com',
              subject: 'Big win',
              body: 'Line 1\nLine 2',
            },
          ],
        },
      ],
    });
    const workflow = {
      id: 'w1',
      name: 'Won deal: follow up',
      description: 'Follow-up',
      isActive: true,
      managedByApp: null,
      draftVersion: null,
      activeVersion: {
        id: 'v1',
        version: 3,
        status: 'ACTIVE',
        definition,
        createdAt: '',
        publishedAt: '',
      },
      lastRun: null,
      nextRunAt: null,
      createdAt: '',
      updatedAt: '',
    } as WorkflowDto;
    const dir = join(tmp, 'pulled-workflows');
    mkdirSync(join(dir, 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'crm.json'), JSON.stringify({ name: 'pulled-app' }));
    const source = workflowSource(workflow)!;
    expect(source).toContain('type: TriggerType.RECORD_UPDATED');
    expect(source).toContain('type: StepType.IF_ELSE');
    writeFileSync(join(dir, 'workflows', `${fileSlug(workflow.name)}.ts`), source);

    const { manifest } = await loadApp(loadConfig(dir));
    const plan = planApp(manifest, {
      objects: [],
      views: [],
      workflows: [
        {
          id: 'w1',
          name: workflow.name,
          description: 'Follow-up',
          managedByApp: 'pulled-app',
          definition,
        },
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.changes).toEqual([]);
  });
});
