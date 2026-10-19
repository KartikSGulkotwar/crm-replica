import type { FieldMetadataDto, ObjectMetadataDto, ViewDto } from '@crm-replica/shared';
import { FieldType, labelToOptionValue } from '@crm-replica/shared';

/** Marks raw code (e.g. `FieldType.TEXT`) inside a value being turned into source. */
class Code {
  constructor(readonly code: string) {}
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A JS value → readable TypeScript source (unquoted keys, single quotes, 2-space indent). */
function toSource(value: unknown, indent = ''): string {
  const next = `${indent}  `;
  if (value instanceof Code) return value.code;
  if (typeof value === 'string')
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => toSource(v, next));
    const oneLine = `[${items.join(', ')}]`;
    if (oneLine.length <= 80 && !oneLine.includes('\n')) return oneLine;
    return `[\n${items.map((i) => `${next}${i},`).join('\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const props = entries.map(
    ([k, v]) => `${IDENTIFIER.test(k) ? k : toSource(k)}: ${toSource(v, next)}`,
  );
  const oneLine = `{ ${props.join(', ')} }`;
  if (oneLine.length <= 100 && !oneLine.includes('\n') && indent.length >= 4) return oneLine;
  return `{\n${props.map((p) => `${next}${p},`).join('\n')}\n${indent}}`;
}

function fieldDefinition(field: FieldMetadataDto): Record<string, unknown> {
  const def: Record<string, unknown> = {
    name: field.name,
    label: field.label,
    type: new Code(`FieldType.${field.type}`),
  };
  if (field.description) def.description = field.description;
  if (field.isRequired) def.isRequired = true;
  if (field.options) {
    def.options = field.options.map((o) =>
      o.value === labelToOptionValue(o.label)
        ? { label: o.label, color: o.color }
        : { label: o.label, value: o.value, color: o.color },
    );
  }
  if (field.type === FieldType.RATING && field.settings?.max && field.settings.max !== 5)
    def.settings = { max: field.settings.max };
  if (
    field.type === FieldType.CURRENCY &&
    field.settings?.currency &&
    field.settings.currency !== 'USD'
  )
    def.settings = { currency: field.settings.currency };
  if (field.relation) {
    def.relation = {
      targetObject: field.relation.targetObjectName,
      inverseName: field.relation.inverseName,
      inverseLabel: field.relation.inverseLabel,
      ...(field.relation.onDelete !== 'SET_NULL' ? { onDelete: field.relation.onDelete } : {}),
    };
  }
  if (field.defaultValue !== null && field.defaultValue !== undefined)
    def.defaultValue = field.defaultValue;
  return def;
}

const HEADER =
  '// Pulled from the workspace by `crm pull`. Edit freely, then `crm diff` / `crm push`.\n';

/**
 * Source for an object file. Custom objects are written in full; standard objects only list
 * their custom fields (the app adds those; it never manages the standard ones).
 */
export function objectSource(object: ObjectMetadataDto): string {
  const fields = object.fields.filter((f) => !f.deletedAt && (object.isCustom || f.isCustom));
  const def: Record<string, unknown> = {
    nameSingular: object.nameSingular,
    namePlural: object.namePlural,
    labelSingular: object.labelSingular,
    labelPlural: object.labelPlural,
    ...(object.description ? { description: object.description } : {}),
    ...(object.icon && object.isCustom ? { icon: object.icon } : {}),
    ...(object.isCustom &&
    object.labelIdentifierFieldName &&
    object.labelIdentifierFieldName !== 'name'
      ? { labelIdentifierFieldName: object.labelIdentifierFieldName }
      : {}),
    fields: fields.map(fieldDefinition),
  };
  return `${HEADER}import { defineObject, FieldType } from '@crm-replica/sdk';\n\nexport default defineObject(${toSource(def)});\n`;
}

export function viewSource(view: ViewDto, objectPlural: string): string {
  const visible = view.fields.filter((f) => f.isVisible);
  const def: Record<string, unknown> = {
    name: view.name,
    object: objectPlural,
    ...(view.type !== 'TABLE' ? { type: new Code(`ViewType.${view.type}`) } : {}),
    ...(view.kanbanFieldName && view.type === 'KANBAN'
      ? { kanbanField: view.kanbanFieldName }
      : {}),
    ...(view.filterConjunction !== 'and' ? { filterConjunction: view.filterConjunction } : {}),
    ...(visible.length !== view.fields.length
      ? {
          fields: visible.map((f) =>
            f.width ? { name: f.fieldName, width: f.width } : f.fieldName,
          ),
        }
      : {}),
    ...(view.filters.length
      ? {
          filters: view.filters.map((f) => ({
            field: f.fieldName,
            op: f.operator,
            value: f.value,
          })),
        }
      : {}),
    ...(view.sorts.length
      ? { sorts: view.sorts.map((s) => ({ field: s.fieldName, direction: s.direction })) }
      : {}),
  };
  const imports = view.type !== 'TABLE' ? 'defineView, ViewType' : 'defineView';
  return `${HEADER}import { ${imports} } from '@crm-replica/sdk';\n\nexport default defineView(${toSource(def)});\n`;
}

/** `Big deals` → `big-deals`. */
export const fileSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'view';
