import { z } from 'zod';
import { FieldType } from '../field-type';
import { FIELD_TYPE_INFO, OPTION_COLORS, OptionColor } from './field-types';
import {
  API_NAME_MAX_LENGTH,
  API_NAME_PATTERN,
  labelToApiName,
  labelToOptionValue,
  RESERVED_OBJECT_NAMES,
  SYSTEM_FIELD_NAMES,
} from './naming';

export const apiNameSchema = z
  .string()
  .max(API_NAME_MAX_LENGTH, `Must be at most ${API_NAME_MAX_LENGTH} characters`)
  .regex(
    API_NAME_PATTERN,
    'Must be camelCase: start with a lowercase letter, then only letters and digits',
  );

const labelSchema = z.string().trim().min(1, 'Required').max(60, 'Must be at most 60 characters');
const descriptionSchema = z.string().trim().max(500).nullish();
/** A plain word naming an icon in the web app's own icon set (e.g. "building", "users"). */
const iconSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,30}$/, 'Must be a lowercase icon name')
  .nullish();

export const optionValueSchema = z.string().regex(/^[A-Z0-9_]{1,60}$/, 'Must be UPPER_SNAKE_CASE');

/** Options can be given as plain labels (`'Won'`) or objects; both normalize to SelectOption. */
const optionInputSchema = z.union([
  labelSchema,
  z.object({
    label: labelSchema,
    value: optionValueSchema.optional(),
    color: z.enum(OPTION_COLORS).optional(),
  }),
]);

export interface SelectOption {
  value: string;
  label: string;
  color: OptionColor;
  position: number;
}

export interface FieldSettings {
  /** RATING: number of stars (1-10, default 5). */
  max?: number;
  /** CURRENCY: currency code used when none is given (default USD). */
  currency?: string;
}

const settingsSchema = z
  .object({
    max: z.number().int().min(1).max(10).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code like USD')
      .optional(),
  })
  .strict();

export const relationOnDeleteSchema = z.enum(['SET_NULL', 'CASCADE', 'RESTRICT']);

const relationInputSchema = z
  .object({
    /** nameSingular of the object this field points to. */
    targetObject: apiNameSchema,
    /** Name of the reverse (one-to-many) list on the target, e.g. `people` on Company. */
    inverseName: apiNameSchema.optional(),
    inverseLabel: labelSchema.optional(),
    onDelete: relationOnDeleteSchema.default('SET_NULL'),
  })
  .strict();

/** Gives each option a stable value and a color; keeps existing values when labels match. */
export function normalizeOptions(
  input: z.infer<typeof optionInputSchema>[],
  existing: SelectOption[] = [],
): SelectOption[] {
  return input.map((item, position) => {
    const o = typeof item === 'string' ? { label: item } : item;
    const previous = existing.find((e) => (o.value ? e.value === o.value : e.label === o.label));
    return {
      value: o.value ?? previous?.value ?? labelToOptionValue(o.label),
      label: o.label,
      color: o.color ?? previous?.color ?? OPTION_COLORS[(position + 1) % OPTION_COLORS.length],
      position,
    };
  });
}

/** Checks a default value against the field's type and options. Returns an error or null. */
export function defaultValueError(
  type: FieldType,
  value: unknown,
  options: SelectOption[] | null | undefined,
  settings: FieldSettings | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (!FIELD_TYPE_INFO[type].supportsDefault)
    return `${FIELD_TYPE_INFO[type].label} fields can't have a default value`;
  const values = new Set((options ?? []).map((o) => o.value));
  switch (type) {
    case FieldType.TEXT:
      return typeof value === 'string' ? null : 'Default must be text';
    case FieldType.NUMBER:
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : 'Default must be a number';
    case FieldType.BOOLEAN:
      return typeof value === 'boolean' ? null : 'Default must be true or false';
    case FieldType.RATING: {
      const max = settings?.max ?? 5;
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max
        ? null
        : `Default must be a whole number from 1 to ${max}`;
    }
    case FieldType.SELECT:
      return typeof value === 'string' && values.has(value)
        ? null
        : 'Default must be one of the option values';
    case FieldType.MULTI_SELECT:
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && values.has(v))
        ? null
        : 'Default must be a list of option values';
    default:
      return 'Unsupported default value';
  }
}

function checkOptionsUnique(options: SelectOption[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.value))
      ctx.addIssue({ code: 'custom', path: ['options'], message: `Duplicate option "${o.label}"` });
    seen.add(o.value);
  }
}

/** Input for creating a field (API, web app and SDK). */
export const createFieldSchema = z
  .object({
    name: apiNameSchema.optional(),
    label: labelSchema,
    type: z.enum(FieldType),
    description: descriptionSchema,
    isRequired: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
    options: z.array(optionInputSchema).max(100).optional(),
    settings: settingsSchema.optional(),
    relation: relationInputSchema.optional(),
  })
  .strict()
  .transform((f, ctx) => {
    const name = f.name ?? labelToApiName(f.label);
    if (!API_NAME_PATTERN.test(name) || name.length > API_NAME_MAX_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Couldn’t derive a valid name from the label; set name',
      });
    }
    if ((SYSTEM_FIELD_NAMES as readonly string[]).includes(name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: `"${name}" is a built-in field name`,
      });
    }
    const isSelect = f.type === FieldType.SELECT || f.type === FieldType.MULTI_SELECT;
    if (isSelect && !f.options?.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option' });
    }
    if (!isSelect && f.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Only select fields have options',
      });
    }
    if (f.type === FieldType.RELATION && !f.relation) {
      ctx.addIssue({ code: 'custom', path: ['relation'], message: 'Choose the object to link to' });
    }
    if (f.type !== FieldType.RELATION && f.relation) {
      ctx.addIssue({
        code: 'custom',
        path: ['relation'],
        message: 'Only relation fields link to objects',
      });
    }
    if (f.settings?.max !== undefined && f.type !== FieldType.RATING) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'max'],
        message: 'Only rating fields have a maximum',
      });
    }
    if (f.settings?.currency !== undefined && f.type !== FieldType.CURRENCY) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'currency'],
        message: 'Only currency fields have a currency',
      });
    }
    const options = isSelect && f.options ? normalizeOptions(f.options) : null;
    if (options) checkOptionsUnique(options, ctx);
    const defaultError = defaultValueError(f.type, f.defaultValue, options, f.settings);
    if (defaultError)
      ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: defaultError });

    return {
      name,
      label: f.label,
      type: f.type,
      description: f.description ?? null,
      isRequired: f.isRequired,
      defaultValue: f.defaultValue ?? null,
      options,
      settings: f.settings ?? null,
      relation: f.relation ?? null,
    };
  });

export type CreateFieldInput = z.input<typeof createFieldSchema>;
export type NormalizedFieldInput = z.output<typeof createFieldSchema>;

/** Editable parts of a field. Name and type are fixed once created. */
export const updateFieldSchema = z
  .object({
    label: labelSchema.optional(),
    description: descriptionSchema,
    isRequired: z.boolean().optional(),
    /** `null` clears the default. */
    defaultValue: z.unknown().optional(),
    /** Replaces the whole option list. Options whose value disappears are cleared from records. */
    options: z.array(optionInputSchema).min(1).max(100).optional(),
    settings: settingsSchema.optional(),
    relation: z.object({ inverseLabel: labelSchema.optional() }).strict().optional(),
  })
  .strict();

export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

const objectNameSchema = apiNameSchema.refine(
  (n) => !(RESERVED_OBJECT_NAMES as readonly string[]).includes(n),
  'This name is reserved',
);

export const createObjectSchema = z
  .object({
    nameSingular: objectNameSchema,
    namePlural: objectNameSchema,
    labelSingular: labelSchema,
    labelPlural: labelSchema,
    description: descriptionSchema,
    icon: iconSchema,
    /** Field shown as the record's title. Defaults to `name`. */
    labelIdentifierFieldName: apiNameSchema.optional(),
    /** Defaults to a single required-ish `name` text field. */
    fields: z.array(createFieldSchema).max(200).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.nameSingular === o.namePlural) {
      ctx.addIssue({
        code: 'custom',
        path: ['namePlural'],
        message: 'Plural name must differ from the singular',
      });
    }
  });

export type CreateObjectInput = z.input<typeof createObjectSchema>;

export const updateObjectSchema = z
  .object({
    labelSingular: labelSchema.optional(),
    labelPlural: labelSchema.optional(),
    description: descriptionSchema,
    icon: iconSchema,
    labelIdentifierFieldName: apiNameSchema.optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export type UpdateObjectInput = z.infer<typeof updateObjectSchema>;

/** Flattens zod issues into `path: message` strings for API error responses. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
}
