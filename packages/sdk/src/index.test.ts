import { appManifestSchema, createObjectSchema } from '@crm-replica/shared';
import { describe, expect, it } from 'vitest';
import { defineField, defineObject, defineView, FieldType, ViewType } from './index';

describe('SDK', () => {
  it('produces definitions the server-side schemas accept (the README example)', () => {
    const deal = defineObject({
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
        { name: 'closeDate', label: 'Close Date', type: FieldType.DATE_TIME },
      ],
    });
    expect(createObjectSchema.safeParse(deal).success).toBe(true);
    const view = defineView({
      name: 'Pipeline',
      object: 'deals',
      type: ViewType.KANBAN,
      kanbanField: 'stage',
    });
    expect(
      appManifestSchema.safeParse({ name: 'sales-app', objects: [deal], views: [view] }).success,
    ).toBe(true);
  });

  it('keeps fields typed by kind', () => {
    const rating = defineField({ label: 'Health', type: FieldType.RATING, settings: { max: 3 } });
    expect(rating.type === FieldType.RATING && rating.settings?.max).toBe(3);
    const base = {
      nameSingular: 'x',
      namePlural: 'xs',
      labelSingular: 'X',
      labelPlural: 'Xs',
      fields: [],
    };
    // @ts-expect-error typos in property names are caught
    defineObject({ ...base, feilds: [] });
    // @ts-expect-error options are only allowed on select fields
    defineField({ label: 'Notes', type: FieldType.TEXT, options: ['x'] });
    // @ts-expect-error relations need a target object
    defineField({ label: 'Company', type: FieldType.RELATION });
  });
});
