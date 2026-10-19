import { z } from 'zod';
import { apiNameSchema } from './metadata/schemas';

export enum ViewType {
  TABLE = 'TABLE',
  KANBAN = 'KANBAN',
}

export interface ViewFieldDto {
  fieldName: string;
  isVisible: boolean;
  /** Column width in pixels (tables). */
  width: number | null;
  position: number;
}

export interface ViewFilterDto {
  fieldName: string;
  operator: string;
  value: unknown;
}

export interface ViewSortDto {
  fieldName: string;
  direction: 'asc' | 'desc';
}

export interface ViewDto {
  id: string;
  objectId: string;
  objectName: string;
  name: string;
  type: ViewType;
  /** Each object has exactly one default view; it can't be deleted. */
  isDefault: boolean;
  /** KANBAN: the select field whose options become columns. */
  kanbanFieldName: string | null;
  /** How filters combine: all must match ('and') or any ('or'). */
  filterConjunction: 'and' | 'or';
  position: number;
  fields: ViewFieldDto[];
  filters: ViewFilterDto[];
  sorts: ViewSortDto[];
}

const viewFieldSchema = z
  .object({
    fieldName: apiNameSchema,
    isVisible: z.boolean().default(true),
    width: z.number().int().min(40).max(2000).nullable().default(null),
  })
  .strict();

const viewFilterSchema = z
  .object({
    fieldName: apiNameSchema,
    operator: z.string().min(1).max(30),
    value: z.unknown().optional(),
  })
  .strict();

const viewSortSchema = z
  .object({ fieldName: apiNameSchema, direction: z.enum(['asc', 'desc']) })
  .strict();

const viewBody = {
  name: z.string().trim().min(1, 'Required').max(60),
  type: z.enum(ViewType),
  kanbanFieldName: apiNameSchema.nullable(),
  filterConjunction: z.enum(['and', 'or']),
  /** Replaces all view fields; their order is the column order. */
  fields: z.array(viewFieldSchema).max(300),
  /** Replaces all filters. */
  filters: z.array(viewFilterSchema).max(50),
  /** Replaces all sorts, most important first. */
  sorts: z.array(viewSortSchema).max(5),
  position: z.number().int().min(0),
};

export const createViewSchema = z
  .object({
    /** The object's plural or singular name, or its id. */
    object: z.string().min(1).max(60),
    name: viewBody.name,
    type: viewBody.type.default(ViewType.TABLE),
    kanbanFieldName: viewBody.kanbanFieldName.optional(),
    filterConjunction: viewBody.filterConjunction.default('and'),
    fields: viewBody.fields.optional(),
    filters: viewBody.filters.default([]),
    sorts: viewBody.sorts.default([]),
  })
  .strict();

export const updateViewSchema = z.object(viewBody).partial().strict();

export type CreateViewInput = z.input<typeof createViewSchema>;
export type UpdateViewInput = z.input<typeof updateViewSchema>;
