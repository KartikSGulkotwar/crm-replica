import { z } from 'zod';
import { apiNameSchema, createObjectSchema, formatZodIssues } from '../metadata/schemas';
import { ViewType } from '../views';

/** e.g. `sales-app`. Stored on everything the app manages, so pushes only touch their own things. */
export const appNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,49}$/,
    'App names use lowercase letters, digits and dashes (e.g. sales-app)',
  );

export const viewDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** The object's singular or plural name. */
    object: apiNameSchema,
    type: z.enum(ViewType).default(ViewType.TABLE),
    /** KANBAN: the select field to group by (defaults to the first select field). */
    kanbanField: apiNameSchema.optional(),
    filterConjunction: z.enum(['and', 'or']).default('and'),
    /** Visible fields, in order. Omit to show every field. */
    fields: z
      .array(
        z.union([
          apiNameSchema,
          z
            .object({ name: apiNameSchema, width: z.number().int().min(40).max(2000).optional() })
            .strict(),
        ]),
      )
      .optional(),
    filters: z
      .array(
        z
          .object({ field: apiNameSchema, op: z.string().min(1), value: z.unknown().optional() })
          .strict(),
      )
      .default([]),
    sorts: z
      .array(
        z
          .object({ field: apiNameSchema, direction: z.enum(['asc', 'desc']).default('asc') })
          .strict(),
      )
      .max(5)
      .default([]),
  })
  .strict();

export type ViewDefinition = z.input<typeof viewDefinitionSchema>;
export type ObjectDefinitionInput = z.input<typeof createObjectSchema>;

/**
 * Everything an app declares. Objects keep their raw (author-written) form: the planner needs
 * to know, for example, whether an option's color was set or left to the current one.
 */
export const appManifestSchema = z
  .object({
    name: appNameSchema,
    objects: z.array(z.record(z.string(), z.unknown())).default([]),
    views: z.array(viewDefinitionSchema).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    const names = new Map<string, number>();
    m.objects.forEach((raw, i) => {
      const parsed = createObjectSchema.safeParse(raw);
      if (!parsed.success) {
        for (const message of formatZodIssues(parsed.error))
          ctx.addIssue({ code: 'custom', path: ['objects', i], message });
        return;
      }
      for (const n of [parsed.data.nameSingular, parsed.data.namePlural]) {
        if (names.has(n))
          ctx.addIssue({
            code: 'custom',
            path: ['objects', i],
            message: `"${n}" is declared twice`,
          });
        names.set(n, i);
      }
      const fieldNames = (parsed.data.fields ?? []).map((f) => f.name);
      const dup = fieldNames.find((n, j) => fieldNames.indexOf(n) !== j);
      if (dup)
        ctx.addIssue({
          code: 'custom',
          path: ['objects', i, 'fields'],
          message: `Field "${dup}" is declared twice`,
        });
    });
    const views = m.views.map((v) => `${v.object}/${v.name}`);
    const dupView = views.find((v, j) => views.indexOf(v) !== j);
    if (dupView)
      ctx.addIssue({
        code: 'custom',
        path: ['views'],
        message: `View "${dupView}" is declared twice`,
      });
  });

export type AppManifest = z.output<typeof appManifestSchema>;
export type AppManifestInput = z.input<typeof appManifestSchema>;

/** Body of POST /api/metadata/apply. */
export const applyRequestSchema = z
  .object({
    manifest: appManifestSchema,
    /** Only compute and return the plan (what `crm diff` does). */
    dryRun: z.boolean().default(false),
    /** Allow changes that delete data (removing objects/fields, changing a field's type). */
    allowDestructive: z.boolean().default(false),
  })
  .strict();
