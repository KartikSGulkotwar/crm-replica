import { describe, expect, it } from 'vitest';
import { FieldType } from '../field-type';
import { camelToSnake, labelToApiName, labelToOptionValue } from './naming';
import {
  createFieldSchema,
  createObjectSchema,
  formatZodIssues,
  normalizeOptions,
  updateFieldSchema,
} from './schemas';

const errorsOf = (result: { success: boolean; error?: unknown }) =>
  result.success ? [] : formatZodIssues(result.error as never);

describe('naming', () => {
  it.each([
    ['name', 'name'],
    ['annualRevenue', 'annual_revenue'],
    ['pointOfContact', 'point_of_contact'],
    ['field2Name', 'field2_name'],
  ])('camelToSnake(%s) = %s', (input, expected) => expect(camelToSnake(input)).toBe(expected));

  it.each([
    ['Close date', 'closeDate'],
    ['Annual Revenue ($)', 'annualRevenue'],
    ['2nd phone', 'n2ndPhone'],
    ['  Café  owner ', 'cafeOwner'],
  ])('labelToApiName(%s) = %s', (input, expected) => expect(labelToApiName(input)).toBe(expected));

  it('turns labels into option values', () => {
    expect(labelToOptionValue('In progress')).toBe('IN_PROGRESS');
    expect(labelToOptionValue('Won!')).toBe('WON');
  });
});

describe('createFieldSchema', () => {
  it('derives the name from the label and fills defaults', () => {
    const parsed = createFieldSchema.parse({ label: 'Close date', type: FieldType.DATE });
    expect(parsed).toMatchObject({
      name: 'closeDate',
      isRequired: false,
      options: null,
      defaultValue: null,
    });
  });

  it('normalizes plain-string select options', () => {
    const parsed = createFieldSchema.parse({
      label: 'Stage',
      type: FieldType.SELECT,
      options: ['Lead', 'Won'],
    });
    expect(parsed.options).toEqual([
      { value: 'LEAD', label: 'Lead', color: expect.any(String), position: 0 },
      { value: 'WON', label: 'Won', color: expect.any(String), position: 1 },
    ]);
  });

  it.each([
    [{ label: 'Stage', type: 'SELECT' }, 'options: Add at least one option'],
    [{ label: 'Stage', type: 'SELECT', options: ['A', 'a'] }, 'options: Duplicate option "a"'],
    [{ label: 'Notes', type: 'TEXT', options: ['x'] }, 'options: Only select fields have options'],
    [{ label: 'Owner', type: 'RELATION' }, 'relation: Choose the object to link to'],
    [{ label: 'Id', type: 'TEXT' }, 'name: "id" is a built-in field name'],
    [{ name: 'Bad Name', label: 'X', type: 'TEXT' }, 'name: Must be camelCase'],
    [{ name: 'x"; DROP TABLE users; --', label: 'X', type: 'TEXT' }, 'name: Must be camelCase'],
    [{ label: 'X', type: 'NOPE' }, 'type:'],
    [{ label: 'X', type: 'TEXT', sneaky: true }, 'Unrecognized key'],
    [
      { label: 'Score', type: 'RATING', defaultValue: 9 },
      'defaultValue: Default must be a whole number from 1 to 5',
    ],
    [
      { label: 'Stage', type: 'SELECT', options: ['A'], defaultValue: 'B' },
      'defaultValue: Default must be one of',
    ],
    [
      { label: 'When', type: 'DATE', defaultValue: '2026-01-01' },
      "defaultValue: Date fields can't have a default",
    ],
  ])('rejects %j', (input, message) => {
    const errors = errorsOf(createFieldSchema.safeParse(input));
    expect(errors.join('\n')).toContain(message);
  });

  it('accepts a relation with an inverse name', () => {
    const parsed = createFieldSchema.parse({
      label: 'Company',
      type: FieldType.RELATION,
      relation: { targetObject: 'company', inverseName: 'people', inverseLabel: 'People' },
    });
    expect(parsed.relation).toEqual({
      targetObject: 'company',
      inverseName: 'people',
      inverseLabel: 'People',
      onDelete: 'SET_NULL',
    });
  });
});

describe('createObjectSchema', () => {
  it('rejects reserved and identical names', () => {
    const errors = errorsOf(
      createObjectSchema.safeParse({
        nameSingular: 'view',
        namePlural: 'view',
        labelSingular: 'V',
        labelPlural: 'Vs',
      }),
    ).join('\n');
    expect(errors).toContain('nameSingular: This name is reserved');
    expect(errors).toContain('namePlural: Plural name must differ from the singular');
  });
});

describe('updateFieldSchema / normalizeOptions', () => {
  it('keeps existing option values and colors when only labels are given', () => {
    const existing = normalizeOptions(['Lead', 'Won']);
    const updated = normalizeOptions(['Won', 'Lead', 'Lost'], existing);
    expect(updated.map((o) => [o.value, o.color])).toEqual([
      ['WON', existing[1].color],
      ['LEAD', existing[0].color],
      ['LOST', expect.any(String)],
    ]);
  });

  it('does not allow changing a field’s name or type', () => {
    expect(updateFieldSchema.safeParse({ type: 'NUMBER' }).success).toBe(false);
    expect(updateFieldSchema.safeParse({ name: 'other' }).success).toBe(false);
  });
});
