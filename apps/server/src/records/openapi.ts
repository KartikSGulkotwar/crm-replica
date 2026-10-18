import { FIELD_TYPE_INFO, FieldType } from '@crm-replica/shared';
import type { OpenAPIObject } from '@nestjs/swagger';
import { FieldModel, ObjectModel, WorkspaceModel } from './object-model';

type Schema = Record<string, unknown>;

/** JSON Schema for one field's value in records. */
function fieldSchema(field: FieldModel): Schema {
  const base: Schema = { description: field.label, nullable: true };
  const values = (field.options ?? []).map((o) => o.value);
  switch (field.type) {
    case FieldType.NUMBER:
      return { ...base, type: 'number' };
    case FieldType.RATING:
      return { ...base, type: 'integer', minimum: 1, maximum: field.settings?.max ?? 5 };
    case FieldType.BOOLEAN:
      return { ...base, type: 'boolean' };
    case FieldType.DATE:
      return { ...base, type: 'string', format: 'date' };
    case FieldType.DATE_TIME:
      return { ...base, type: 'string', format: 'date-time' };
    case FieldType.EMAIL:
      return { ...base, type: 'string', format: 'email' };
    case FieldType.LINK:
      return { ...base, type: 'string', format: 'uri' };
    case FieldType.SELECT:
      return { ...base, type: 'string', enum: values };
    case FieldType.MULTI_SELECT:
      return { ...base, nullable: false, type: 'array', items: { type: 'string', enum: values } };
    case FieldType.CURRENCY:
      return {
        ...base,
        type: 'object',
        properties: {
          amount: { type: 'number', nullable: true },
          currency: { type: 'string', example: field.settings?.currency ?? 'USD' },
        },
      };
    case FieldType.RELATION:
      return {
        ...base,
        type: 'string',
        format: 'uuid',
        description: `${field.label} (id of a ${field.relationTarget})`,
      };
    default:
      return { ...base, type: 'string' };
  }
}

const schemaName = (o: ObjectModel) =>
  o.nameSingular.charAt(0).toUpperCase() + o.nameSingular.slice(1);

function objectSchemas(object: ObjectModel): Record<string, Schema> {
  const fields = Object.fromEntries(object.fields.map((f) => [f.apiKey, fieldSchema(f)]));
  const name = schemaName(object);
  return {
    [name]: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        createdBy: { type: 'string', format: 'uuid', nullable: true },
        position: { type: 'number' },
        ...fields,
      },
    },
    [`${name}Input`]: {
      type: 'object',
      additionalProperties: false,
      properties: { ...fields, position: { type: 'number' } },
      required: object.fields
        .filter((f) => f.isRequired && f.defaultValue == null)
        .map((f) => f.apiKey),
    },
    [`${name}List`]: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: `#/components/schemas/${name}` } },
        pageInfo: {
          type: 'object',
          properties: {
            hasNextPage: { type: 'boolean' },
            endCursor: { type: 'string', nullable: true },
          },
        },
        totalCount: { type: 'integer' },
      },
    },
  };
}

function filterHelp(object: ObjectModel): string {
  const lines = [...object.systemFields, ...object.fields].map(
    (f) =>
      `- \`${f.name}\` (${FIELD_TYPE_INFO[f.type].label}): ${(f.system && f.type === FieldType.RELATION ? ['eq', 'neq', 'in', 'notIn'] : FIELD_TYPE_INFO[f.type].operators).join(', ')}`,
  );
  return [
    'JSON filter tree. Combine conditions with `and`, `or`, `not`.',
    '',
    'Example: `{"and":[{"field":"name","op":"contains","value":"acme"},{"field":"createdAt","op":"gte","value":"2026-01-01"}]}`',
    '',
    'Fields and operators:',
    ...lines,
  ].join('\n');
}

function objectPaths(object: ObjectModel): Record<string, Schema> {
  const name = schemaName(object);
  const tag = object.labelPlural;
  const ref = (s: string) => ({ $ref: `#/components/schemas/${s}` });
  const json = (schema: Schema) => ({ content: { 'application/json': { schema } } });
  const idParam = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  };
  const expandables = [
    ...object.fields.filter((f) => f.relationTarget).map((f) => f.name),
    ...object.inverseRelations.map((r) => r.name),
  ];
  const expand = {
    name: 'expand',
    in: 'query',
    required: false,
    description: expandables.length
      ? `Comma-separated: ${expandables.join(', ')}`
      : 'This object has no relations',
    schema: { type: 'string' },
  };
  const readOnly = object.isSystem;
  const base = `/api/objects/${object.namePlural}`;

  return {
    [base]: {
      get: {
        tags: [tag],
        summary: `List ${object.labelPlural.toLowerCase()}`,
        parameters: [
          {
            name: 'filter',
            in: 'query',
            required: false,
            description: filterHelp(object),
            schema: { type: 'string' },
          },
          {
            name: 'sort',
            in: 'query',
            required: false,
            description:
              'Comma-separated `field:asc|desc`, e.g. `createdAt:desc`. Default: manual order.',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            description: '`pageInfo.endCursor` of the previous page',
            schema: { type: 'string' },
          },
          expand,
        ],
        responses: { 200: { description: 'A page of records', ...json(ref(`${name}List`)) } },
      },
      ...(readOnly
        ? {}
        : {
            post: {
              tags: [tag],
              summary: `Create a ${object.labelSingular.toLowerCase()}`,
              requestBody: { required: true, ...json(ref(`${name}Input`)) },
              responses: {
                201: { description: 'Created', ...json(ref(name)) },
                400: { description: 'Invalid values' },
              },
            },
          }),
    },
    [`${base}/{id}`]: {
      get: {
        tags: [tag],
        summary: `Get a ${object.labelSingular.toLowerCase()}`,
        parameters: [idParam, expand],
        responses: { 200: json(ref(name)), 404: { description: 'Not found' } },
      },
      ...(readOnly
        ? {}
        : {
            patch: {
              tags: [tag],
              summary: `Update a ${object.labelSingular.toLowerCase()}`,
              parameters: [idParam],
              requestBody: { required: true, ...json(ref(`${name}Input`)) },
              responses: {
                200: json(ref(name)),
                400: { description: 'Invalid values' },
                404: { description: 'Not found' },
              },
            },
            delete: {
              tags: [tag],
              summary: `Delete a ${object.labelSingular.toLowerCase()} (can be restored)`,
              parameters: [idParam],
              responses: { 200: json(ref(name)), 404: { description: 'Not found' } },
            },
          }),
    },
    ...(readOnly
      ? {}
      : {
          [`${base}/{id}/restore`]: {
            post: {
              tags: [tag],
              summary: `Restore a deleted ${object.labelSingular.toLowerCase()}`,
              parameters: [idParam],
              responses: { 200: json(ref(name)) },
            },
          },
        }),
  };
}

/**
 * The API description for one workspace: the static endpoints plus concrete record endpoints
 * and schemas for every object it has right now. Built per request, so it is always current.
 */
export function buildWorkspaceOpenApi(
  base: OpenAPIObject,
  model: WorkspaceModel,
  workspaceName: string,
): OpenAPIObject {
  const doc: OpenAPIObject = structuredClone(base);
  for (const path of Object.keys(doc.paths)) {
    if (path.startsWith('/api/objects/{plural}')) delete doc.paths[path];
  }
  doc.info = {
    ...doc.info,
    description: `${doc.info.description ?? ''}\n\nShowing the data model of **${workspaceName}**.`,
  };
  doc.components = { ...doc.components, schemas: { ...doc.components?.schemas } };
  const objects = [...model.objects].sort((a, b) => Number(a.isSystem) - Number(b.isSystem));
  for (const object of objects) {
    Object.assign(doc.paths, objectPaths(object));
    Object.assign(doc.components.schemas!, objectSchemas(object));
  }
  const objectTags = objects.map((o) => ({
    name: o.labelPlural,
    description: `Records of ${o.labelPlural}`,
  }));
  doc.tags = [...(doc.tags ?? []).filter((t) => t.name !== 'records'), ...objectTags];
  return doc;
}
