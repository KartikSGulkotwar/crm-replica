import { describe, expect, it } from 'vitest';
import { FieldType } from '../field-type';
import type { FieldMetadataDto, ObjectMetadataDto } from '../metadata/dto';
import { ViewDto, ViewType } from '../views';
import { appManifestSchema, AppManifestInput } from './manifest';
import { CurrentState, planApp } from './plan';

const field = (
  name: string,
  type: FieldType,
  extra: Partial<FieldMetadataDto> = {},
): FieldMetadataDto => ({
  id: `f-${name}`,
  objectId: 'o',
  name,
  label: name[0].toUpperCase() + name.slice(1),
  type,
  description: null,
  isCustom: true,
  isRequired: false,
  defaultValue: null,
  options: null,
  settings: null,
  relation: null,
  position: 0,
  managedByApp: 'sales-app',
  deletedAt: null,
  ...extra,
});

const object = (
  nameSingular: string,
  namePlural: string,
  fields: FieldMetadataDto[],
  extra: Partial<ObjectMetadataDto> = {},
): ObjectMetadataDto => ({
  id: `o-${nameSingular}`,
  nameSingular,
  namePlural,
  labelSingular: nameSingular[0].toUpperCase() + nameSingular.slice(1),
  labelPlural: namePlural[0].toUpperCase() + namePlural.slice(1),
  description: null,
  icon: null,
  isCustom: true,
  isSystem: false,
  labelIdentifierFieldName: 'name',
  position: 0,
  managedByApp: 'sales-app',
  deletedAt: null,
  fields,
  inverseRelations: [],
  ...extra,
});

const company = object(
  'company',
  'companies',
  [field('name', FieldType.TEXT, { isCustom: false, managedByApp: null })],
  { isCustom: false, managedByApp: null },
);

const dealDef = {
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  fields: [
    { name: 'name', label: 'Name', type: FieldType.TEXT },
    { name: 'amount', label: 'Amount', type: FieldType.CURRENCY },
    {
      name: 'stage',
      label: 'Stage',
      type: FieldType.SELECT,
      options: ['Lead', 'Negotiation', 'Won', 'Lost'],
    },
    {
      name: 'company',
      label: 'Company',
      type: FieldType.RELATION,
      relation: { targetObject: 'company', inverseName: 'deals' },
    },
  ],
};

/** The deal object as the server would have created it from dealDef. */
const dealInWorkspace = () =>
  object('deal', 'deals', [
    field('name', FieldType.TEXT),
    field('amount', FieldType.CURRENCY),
    field('stage', FieldType.SELECT, {
      options: [
        { value: 'LEAD', label: 'Lead', color: 'red', position: 0 },
        { value: 'NEGOTIATION', label: 'Negotiation', color: 'orange', position: 1 },
        { value: 'WON', label: 'Won', color: 'yellow', position: 2 },
        { value: 'LOST', label: 'Lost', color: 'green', position: 3 },
      ],
    }),
    field('company', FieldType.RELATION, {
      relation: {
        targetObjectId: company.id,
        targetObjectName: 'company',
        inverseName: 'deals',
        inverseLabel: 'Deals',
        onDelete: 'SET_NULL',
      },
    }),
  ]);

const plan = (manifest: Partial<AppManifestInput>, current: Partial<CurrentState> = {}) =>
  planApp(appManifestSchema.parse({ name: 'sales-app', ...manifest }), {
    objects: [company],
    views: [],
    ...current,
  });

const kinds = (p: ReturnType<typeof plan>) =>
  p.changes.map(
    (c) => `${c.kind} ${c.object}${c.field ? `.${c.field}` : ''}${c.view ? ` "${c.view}"` : ''}`,
  );

describe('planApp', () => {
  it('creates a new object, adding relations after the plain fields', () => {
    const p = plan({ objects: [dealDef] });
    expect(p.errors).toEqual([]);
    expect(kinds(p)).toEqual(['createObject deal', 'createField deal.company']);
    expect(p.changes[0].details).toEqual([
      '+ name (TEXT)',
      '+ amount (CURRENCY)',
      '+ stage (SELECT)',
    ]);
    expect(p.changes.every((c) => !c.destructive)).toBe(true);
  });

  it('is a no-op when the workspace already matches (colors left unset keep their current value)', () => {
    expect(plan({ objects: [dealDef] }, { objects: [company, dealInWorkspace()] }).changes).toEqual(
      [],
    );
  });

  it('updates labels, options and settings without being destructive', () => {
    const def = structuredClone(dealDef);
    def.labelPlural = 'Pipeline deals';
    def.fields[2] = {
      ...def.fields[2],
      options: ['Lead', 'Negotiation', 'Won', 'Lost', 'On hold'],
    } as never;
    def.fields[1] = { ...def.fields[1], settings: { currency: 'EUR' } } as never;
    const p = plan({ objects: [def] }, { objects: [company, dealInWorkspace()] });
    expect(kinds(p)).toEqual([
      'updateObject deal',
      'updateField deal.amount',
      'updateField deal.stage',
    ]);
    expect(p.changes[1].details).toEqual(['currency: USD → EUR']);
    expect(p.changes[2].details).toEqual(['options added: On hold']);
    expect(p.changes.some((c) => c.destructive)).toBe(false);
  });

  it('marks type changes and removals of app-managed fields as destructive', () => {
    const def = structuredClone(dealDef);
    def.fields = def.fields.filter((f) => f.name !== 'company');
    def.fields[1] = { name: 'amount', label: 'Amount', type: FieldType.NUMBER } as never;
    const p = plan({ objects: [def] }, { objects: [company, dealInWorkspace()] });
    expect(kinds(p)).toEqual(['recreateField deal.amount', 'removeField deal.company']);
    expect(p.changes.map((c) => c.destructive)).toEqual([true, true]);
    expect(p.changes[0].summary).toContain('type CURRENCY → NUMBER');
  });

  it('never removes fields or objects it doesn’t manage', () => {
    const deal = dealInWorkspace();
    deal.fields.push(field('notes', FieldType.TEXT, { managedByApp: null })); // added in the UI
    const uiObject = object('ticket', 'tickets', [field('name', FieldType.TEXT)], {
      managedByApp: null,
    });
    const otherApp = object('invoice', 'invoices', [field('name', FieldType.TEXT)], {
      managedByApp: 'billing-app',
    });
    expect(
      plan({ objects: [dealDef] }, { objects: [company, deal, uiObject, otherApp] }).changes,
    ).toEqual([]);
  });

  it('removes objects the app manages but no longer declares (their views go with them)', () => {
    const view = {
      id: 'v1',
      objectId: 'o-deal',
      objectName: 'deal',
      name: 'Pipeline',
      type: ViewType.TABLE,
      isDefault: false,
      kanbanFieldName: null,
      filterConjunction: 'and' as const,
      position: 1,
      managedByApp: 'sales-app',
      fields: [],
      filters: [],
      sorts: [],
    };
    const p = plan({ objects: [] }, { objects: [company, dealInWorkspace()], views: [view] });
    expect(kinds(p)).toEqual(['removeObject deal']);
    expect(p.changes[0].destructive).toBe(true);
  });

  it('adopts a matching object created in the UI', () => {
    const deal = dealInWorkspace();
    deal.managedByApp = null;
    deal.fields.forEach((f) => (f.managedByApp = null));
    const p = plan({ objects: [dealDef] }, { objects: [company, deal] });
    expect(kinds(p)).toEqual([
      'updateObject deal',
      'updateField deal.name',
      'updateField deal.amount',
      'updateField deal.stage',
      'updateField deal.company',
    ]);
    expect(p.changes[0].details).toEqual(['now managed by this app']);
  });

  it('adds custom fields to a standard object without taking it over', () => {
    const p = plan({
      objects: [
        {
          nameSingular: 'company',
          namePlural: 'companies',
          labelSingular: 'Company',
          labelPlural: 'Companies',
          fields: [
            { name: 'name', label: 'Name', type: FieldType.TEXT },
            { label: 'Tier', type: FieldType.RATING },
          ],
        },
      ],
    });
    expect(kinds(p)).toEqual(['createField company.tier']);
  });

  it('reports impossible manifests as errors', () => {
    const renamed = { ...dealDef, namePlural: 'dealz' };
    expect(plan({ objects: [renamed] }, { objects: [company, dealInWorkspace()] }).errors).toEqual([
      'deal: its plural name is "deals" and can’t be changed to "dealz"',
    ]);
    expect(
      plan({ objects: [{ ...dealDef, nameSingular: 'thing', namePlural: 'companies' }] }).errors[0],
    ).toContain('already used by Companies');
    expect(plan({ views: [{ name: 'X', object: 'nope' }] }).errors).toEqual([
      'View "X": unknown object "nope"',
    ]);
  });

  it('creates, updates and removes views it manages', () => {
    const existing: ViewDto = {
      id: 'v1',
      objectId: 'o-deal',
      objectName: 'deal',
      name: 'Pipeline',
      type: ViewType.TABLE,
      isDefault: false,
      kanbanFieldName: null,
      filterConjunction: 'and',
      position: 1,
      managedByApp: 'sales-app',
      fields: [],
      filters: [],
      sorts: [],
    };
    const stale = { ...existing, id: 'v2', name: 'Old view' };
    const p = plan(
      {
        objects: [dealDef],
        views: [
          { name: 'Pipeline', object: 'deals', type: ViewType.KANBAN, kanbanField: 'stage' },
          {
            name: 'Big deals',
            object: 'deal',
            filters: [{ field: 'amount', op: 'gte', value: 50000 }],
            sorts: [{ field: 'amount', direction: 'desc' }],
          },
        ],
      },
      { objects: [company, dealInWorkspace()], views: [existing, stale] },
    );
    expect(kinds(p)).toEqual([
      'createView deal "Big deals"',
      'updateView deal "Pipeline"',
      'removeView deal "Old view"',
    ]);
    expect(p.changes[1].details).toEqual(['layout: TABLE → KANBAN', 'grouped by: null → stage']);
  });

  it('validates manifests', () => {
    expect(appManifestSchema.safeParse({ name: 'Sales App' }).success).toBe(false);
    const dup = appManifestSchema.safeParse({ name: 'sales-app', objects: [dealDef, dealDef] });
    expect(dup.success).toBe(false);
    const badField = appManifestSchema.safeParse({
      name: 'sales-app',
      objects: [{ ...dealDef, fields: [{ label: 'X', type: 'NOPE' }] }],
    });
    expect(badField.success).toBe(false);
  });
});
