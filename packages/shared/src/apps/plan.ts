import { FieldType } from '../field-type';
import type { FieldMetadataDto, ObjectMetadataDto } from '../metadata/dto';
import {
  CreateFieldInput,
  createFieldSchema,
  createObjectSchema,
  normalizeOptions,
  SelectOption,
  UpdateFieldInput,
  UpdateObjectInput,
} from '../metadata/schemas';
import { ViewDto, ViewType } from '../views';
import { AppManifest, ObjectDefinitionInput, viewDefinitionSchema } from './manifest';

export type ChangeKind =
  | 'restoreObject'
  | 'createObject'
  | 'updateObject'
  | 'createField'
  | 'restoreField'
  | 'updateField'
  | 'recreateField'
  | 'removeField'
  | 'removeObject'
  | 'createView'
  | 'updateView'
  | 'removeView';

/** A view as the executor creates/updates it. `visibleFields` lists visible fields in order. */
export interface PlannedView {
  name: string;
  objectName: string;
  type: ViewType;
  kanbanFieldName?: string;
  filterConjunction: 'and' | 'or';
  visibleFields?: { fieldName: string; width: number | null }[];
  filters: { fieldName: string; operator: string; value: unknown }[];
  sorts: { fieldName: string; direction: 'asc' | 'desc' }[];
}

export type ChangePayload =
  | { kind: 'restoreObject'; objectId: string }
  | { kind: 'createObject'; input: ObjectDefinitionInput }
  | { kind: 'updateObject'; objectId: string; changes: UpdateObjectInput; adopt: boolean }
  | { kind: 'createField'; objectName: string; input: CreateFieldInput }
  | { kind: 'restoreField'; fieldId: string }
  | { kind: 'updateField'; fieldId: string; changes: UpdateFieldInput; adopt: boolean }
  | { kind: 'recreateField'; fieldId: string; objectName: string; input: CreateFieldInput }
  | { kind: 'removeField'; fieldId: string }
  | { kind: 'removeObject'; objectId: string }
  | { kind: 'createView'; view: PlannedView }
  | { kind: 'updateView'; viewId: string; view: PlannedView; adopt: boolean }
  | { kind: 'removeView'; viewId: string };

export interface PlanChange {
  kind: ChangeKind;
  /** nameSingular of the object concerned. */
  object: string;
  field?: string;
  view?: string;
  /** True when applying it deletes data (needs --allow-destructive). */
  destructive: boolean;
  /** One line for humans, e.g. `Add field deal.amount (Currency)`. */
  summary: string;
  /** Extra lines, e.g. what changes in a field. */
  details: string[];
  payload: ChangePayload;
}

export interface AppPlan {
  app: string;
  changes: PlanChange[];
  /** Problems that make the manifest impossible to apply (nothing is applied if any). */
  errors: string[];
}

export interface CurrentState {
  /** All objects including soft-deleted ones and their deleted fields. */
  objects: ObjectMetadataDto[];
  views: ViewDto[];
}

const ORDER: ChangeKind[] = [
  'restoreObject',
  'createObject',
  'updateObject',
  'createField',
  'restoreField',
  'updateField',
  'recreateField',
  'removeField',
  'removeObject',
  'createView',
  'updateView',
  'removeView',
];

const json = (v: unknown) => JSON.stringify(v ?? null);
const effectiveMax = (s: { max?: number } | null | undefined) => s?.max ?? 5;
const effectiveCurrency = (s: { currency?: string } | null | undefined) => s?.currency ?? 'USD';
const optionsKey = (options: SelectOption[] | null | undefined) =>
  json((options ?? []).map((o) => [o.value, o.label, o.color]));

/** What would change in an existing field to match its definition. */
function compareField(
  current: FieldMetadataDto,
  raw: CreateFieldInput,
): { recreate?: string; changes: UpdateFieldInput; details: string[] } {
  const desired = createFieldSchema.parse(raw);
  if (desired.type !== current.type)
    return { recreate: `type ${current.type} → ${desired.type}`, changes: {}, details: [] };
  if (desired.relation && current.relation) {
    if (desired.relation.targetObject !== current.relation.targetObjectName) {
      return {
        recreate: `links to ${current.relation.targetObjectName} → ${desired.relation.targetObject}`,
        changes: {},
        details: [],
      };
    }
    if (
      desired.relation.inverseName &&
      desired.relation.inverseName !== current.relation.inverseName
    ) {
      return {
        recreate: `reverse name ${current.relation.inverseName} → ${desired.relation.inverseName}`,
        changes: {},
        details: [],
      };
    }
    if (desired.relation.onDelete !== current.relation.onDelete) {
      return {
        recreate: `on delete ${current.relation.onDelete} → ${desired.relation.onDelete}`,
        changes: {},
        details: [],
      };
    }
  }

  const changes: UpdateFieldInput = {};
  const details: string[] = [];
  if (desired.label !== current.label) {
    changes.label = desired.label;
    details.push(`label: "${current.label}" → "${desired.label}"`);
  }
  if ((desired.description ?? null) !== (current.description ?? null)) {
    changes.description = desired.description;
    details.push('description changed');
  }
  if (desired.isRequired !== current.isRequired) {
    changes.isRequired = desired.isRequired;
    details.push(desired.isRequired ? 'now required' : 'no longer required');
  }
  if (raw.options) {
    // Normalize against the current options so unchanged labels keep their values and colors.
    const options = normalizeOptions(raw.options, current.options ?? []);
    if (optionsKey(options) !== optionsKey(current.options)) {
      changes.options = options.map(({ value, label, color }) => ({ value, label, color }));
      const before = (current.options ?? []).map((o) => o.label);
      const after = options.map((o) => o.label);
      const added = after.filter((l) => !before.includes(l));
      const removed = before.filter((l) => !after.includes(l));
      details.push(
        [
          added.length && `options added: ${added.join(', ')}`,
          removed.length && `options removed: ${removed.join(', ')}`,
        ]
          .filter(Boolean)
          .join('; ') || 'options reordered or recolored',
      );
    }
  }
  if (
    desired.type === FieldType.RATING &&
    effectiveMax(desired.settings) !== effectiveMax(current.settings)
  ) {
    changes.settings = { max: effectiveMax(desired.settings) };
    details.push(`stars: ${effectiveMax(current.settings)} → ${effectiveMax(desired.settings)}`);
  }
  if (
    desired.type === FieldType.CURRENCY &&
    effectiveCurrency(desired.settings) !== effectiveCurrency(current.settings)
  ) {
    changes.settings = { currency: effectiveCurrency(desired.settings) };
    details.push(
      `currency: ${effectiveCurrency(current.settings)} → ${effectiveCurrency(desired.settings)}`,
    );
  }
  if (json(desired.defaultValue) !== json(current.defaultValue)) {
    changes.defaultValue = desired.defaultValue;
    details.push(`default: ${json(current.defaultValue)} → ${json(desired.defaultValue)}`);
  }
  if (
    desired.relation?.inverseLabel &&
    current.relation &&
    desired.relation.inverseLabel !== current.relation.inverseLabel
  ) {
    changes.relation = { inverseLabel: desired.relation.inverseLabel };
    details.push(
      `reverse label: "${current.relation.inverseLabel}" → "${desired.relation.inverseLabel}"`,
    );
  }
  return { changes, details };
}

function typeLabel(raw: CreateFieldInput) {
  return raw.type === FieldType.RELATION ? `Relation → ${raw.relation?.targetObject}` : raw.type;
}

/** Resolves a view definition against the object names it may use. */
function plannedView(def: AppManifest['views'][number], objectName: string): PlannedView {
  const v = viewDefinitionSchema.parse(def);
  return {
    name: v.name,
    objectName,
    type: v.type,
    kanbanFieldName: v.kanbanField,
    filterConjunction: v.filterConjunction,
    visibleFields: v.fields?.map((f) =>
      typeof f === 'string'
        ? { fieldName: f, width: null }
        : { fieldName: f.name, width: f.width ?? null },
    ),
    filters: v.filters.map((f) => ({ fieldName: f.field, operator: f.op, value: f.value ?? null })),
    sorts: v.sorts.map((s) => ({ fieldName: s.field, direction: s.direction })),
  };
}

function compareView(current: ViewDto, desired: PlannedView): string[] {
  const details: string[] = [];
  if (current.type !== desired.type) details.push(`layout: ${current.type} → ${desired.type}`);
  if (
    desired.type === ViewType.KANBAN &&
    desired.kanbanFieldName &&
    desired.kanbanFieldName !== current.kanbanFieldName
  ) {
    details.push(`grouped by: ${current.kanbanFieldName} → ${desired.kanbanFieldName}`);
  }
  if (current.filterConjunction !== desired.filterConjunction)
    details.push(`filters combine with: ${desired.filterConjunction}`);
  const currentFilters = current.filters.map((f) => ({
    fieldName: f.fieldName,
    operator: f.operator,
    value: f.value ?? null,
  }));
  if (json(currentFilters) !== json(desired.filters)) details.push('filters changed');
  if (json(current.sorts) !== json(desired.sorts)) details.push('sorts changed');
  if (desired.visibleFields) {
    const visible = current.fields
      .filter((f) => f.isVisible)
      .map((f) => ({ fieldName: f.fieldName, width: f.width }));
    if (json(visible) !== json(desired.visibleFields)) details.push('fields changed');
  }
  return details;
}

/**
 * Compares an app's manifest with a workspace and lists the changes needed. Pure, so `crm diff`
 * and `crm push` (and the tests) see exactly the same plan.
 *
 * Rules: things in the manifest are created or updated to match. Things missing from it are
 * removed only if this app manages them, so UI-made objects and fields are never deleted.
 * Existing custom objects with a matching name are adopted by the app.
 */
export function planApp(manifest: AppManifest, current: CurrentState): AppPlan {
  const app = manifest.name;
  const changes: PlanChange[] = [];
  const errors: string[] = [];
  const add = (
    change: Omit<PlanChange, 'details' | 'destructive'> &
      Partial<Pick<PlanChange, 'details' | 'destructive'>>,
  ) => changes.push({ destructive: false, details: [], ...change });

  const desiredObjects = manifest.objects.map((raw) => ({
    raw: raw as ObjectDefinitionInput,
    parsed: createObjectSchema.parse(raw),
  }));
  const declaredNames = new Set(desiredObjects.map((o) => o.parsed.nameSingular));

  for (const { raw, parsed } of desiredObjects) {
    const existing = current.objects.find((o) => o.nameSingular === parsed.nameSingular);
    const rawFields = (raw.fields ?? []) as CreateFieldInput[];
    const fieldsWithNames = rawFields.map((f, i) => ({ raw: f, name: parsed.fields![i].name }));

    if (!existing) {
      const clash = current.objects.find(
        (o) =>
          o.namePlural === parsed.namePlural ||
          o.nameSingular === parsed.namePlural ||
          o.namePlural === parsed.nameSingular,
      );
      if (clash) {
        errors.push(
          `${parsed.nameSingular}: the name "${parsed.namePlural}" is already used by ${clash.labelPlural}`,
        );
        continue;
      }
      // Relations are added after all objects exist (they may point at each other).
      const plain = fieldsWithNames.filter((f) => f.raw.type !== FieldType.RELATION);
      add({
        kind: 'createObject',
        object: parsed.nameSingular,
        summary: `Create object ${parsed.nameSingular} (${parsed.labelPlural}) with ${plain.length} field${plain.length === 1 ? '' : 's'}`,
        details: plain.map((f) => `+ ${f.name} (${typeLabel(f.raw)})`),
        payload: {
          kind: 'createObject',
          input: { ...raw, fields: plain.map((f) => ({ ...f.raw, name: f.name })) },
        },
      });
      for (const f of fieldsWithNames.filter((x) => x.raw.type === FieldType.RELATION)) {
        add({
          kind: 'createField',
          object: parsed.nameSingular,
          field: f.name,
          summary: `Add field ${parsed.nameSingular}.${f.name} (${typeLabel(f.raw)})`,
          payload: {
            kind: 'createField',
            objectName: parsed.nameSingular,
            input: { ...f.raw, name: f.name },
          },
        });
      }
      continue;
    }

    if (existing.isSystem) {
      errors.push(`${parsed.nameSingular}: system objects can’t be managed by apps`);
      continue;
    }
    if (existing.namePlural !== parsed.namePlural) {
      errors.push(
        `${parsed.nameSingular}: its plural name is "${existing.namePlural}" and can’t be changed to "${parsed.namePlural}"`,
      );
      continue;
    }
    if (existing.deletedAt) {
      add({
        kind: 'restoreObject',
        object: parsed.nameSingular,
        summary: `Restore deleted object ${parsed.nameSingular}`,
        payload: { kind: 'restoreObject', objectId: existing.id },
      });
    }

    const objectChanges: UpdateObjectInput = {};
    const objectDetails: string[] = [];
    if (parsed.labelSingular !== existing.labelSingular)
      objectChanges.labelSingular = parsed.labelSingular;
    if (parsed.labelPlural !== existing.labelPlural) objectChanges.labelPlural = parsed.labelPlural;
    if ((parsed.description ?? null) !== (existing.description ?? null))
      objectChanges.description = parsed.description ?? null;
    if (parsed.icon !== undefined && (parsed.icon ?? null) !== (existing.icon ?? null))
      objectChanges.icon = parsed.icon ?? null;
    if (
      parsed.labelIdentifierFieldName &&
      parsed.labelIdentifierFieldName !== existing.labelIdentifierFieldName
    ) {
      objectChanges.labelIdentifierFieldName = parsed.labelIdentifierFieldName;
    }
    for (const [key, value] of Object.entries(objectChanges))
      objectDetails.push(`${key}: ${json((existing as never)[key])} → ${json(value)}`);
    const adopt = existing.isCustom && existing.managedByApp !== app;
    if (adopt)
      objectDetails.push(
        existing.managedByApp
          ? `taken over from app "${existing.managedByApp}"`
          : 'now managed by this app',
      );
    if (objectDetails.length) {
      add({
        kind: 'updateObject',
        object: parsed.nameSingular,
        summary: `Update object ${parsed.nameSingular}`,
        details: objectDetails,
        payload: { kind: 'updateObject', objectId: existing.id, changes: objectChanges, adopt },
      });
    }

    for (const { raw: fieldRaw, name } of fieldsWithNames) {
      const input = { ...fieldRaw, name };
      const cf = existing.fields.find((f) => f.name === name);
      if (!cf) {
        add({
          kind: 'createField',
          object: parsed.nameSingular,
          field: name,
          summary: `Add field ${parsed.nameSingular}.${name} (${typeLabel(fieldRaw)})`,
          payload: { kind: 'createField', objectName: parsed.nameSingular, input },
        });
        continue;
      }
      if (!cf.isCustom && fieldRaw.type !== cf.type) {
        errors.push(
          `${parsed.nameSingular}.${name}: standard field of type ${cf.type} can’t become ${fieldRaw.type}`,
        );
        continue;
      }
      if (cf.deletedAt) {
        add({
          kind: 'restoreField',
          object: parsed.nameSingular,
          field: name,
          summary: `Restore deleted field ${parsed.nameSingular}.${name}`,
          payload: { kind: 'restoreField', fieldId: cf.id },
        });
      }
      const compared = compareField(cf, input);
      if (compared.recreate) {
        add({
          kind: 'recreateField',
          object: parsed.nameSingular,
          field: name,
          destructive: true,
          summary: `Replace field ${parsed.nameSingular}.${name} (${compared.recreate}); its values are deleted`,
          payload: {
            kind: 'recreateField',
            fieldId: cf.id,
            objectName: parsed.nameSingular,
            input,
          },
        });
        continue;
      }
      const adoptField = cf.isCustom && cf.managedByApp !== app;
      const details = [...compared.details, ...(adoptField ? ['now managed by this app'] : [])];
      if (details.length) {
        add({
          kind: 'updateField',
          object: parsed.nameSingular,
          field: name,
          summary: `Update field ${parsed.nameSingular}.${name}`,
          details,
          payload: {
            kind: 'updateField',
            fieldId: cf.id,
            changes: compared.changes,
            adopt: adoptField,
          },
        });
      }
    }

    const declaredFields = new Set(fieldsWithNames.map((f) => f.name));
    for (const cf of existing.fields) {
      if (cf.managedByApp === app && !cf.deletedAt && !declaredFields.has(cf.name)) {
        add({
          kind: 'removeField',
          object: parsed.nameSingular,
          field: cf.name,
          destructive: true,
          summary: `Remove field ${parsed.nameSingular}.${cf.name}; its values are deleted`,
          payload: { kind: 'removeField', fieldId: cf.id },
        });
      }
    }
  }

  for (const o of current.objects) {
    if (o.managedByApp === app && !o.deletedAt && !declaredNames.has(o.nameSingular)) {
      add({
        kind: 'removeObject',
        object: o.nameSingular,
        destructive: true,
        summary: `Remove object ${o.nameSingular} (${o.labelPlural}) and all its records`,
        payload: { kind: 'removeObject', objectId: o.id },
      });
    }
  }

  // Views: matched by object + name.
  const resolveObject = (ref: string) => {
    const desired = desiredObjects.find(
      (o) => o.parsed.nameSingular === ref || o.parsed.namePlural === ref,
    );
    if (desired) return desired.parsed.nameSingular;
    return current.objects.find(
      (o) => !o.deletedAt && (o.nameSingular === ref || o.namePlural === ref),
    )?.nameSingular;
  };
  const declaredViews = new Set<string>();
  for (const def of manifest.views) {
    const objectName = resolveObject(def.object);
    if (!objectName) {
      errors.push(`View "${def.name}": unknown object "${def.object}"`);
      continue;
    }
    const view = plannedView(def, objectName);
    declaredViews.add(`${objectName}/${view.name}`);
    const existing = current.views.find((v) => v.objectName === objectName && v.name === view.name);
    if (!existing) {
      add({
        kind: 'createView',
        object: objectName,
        view: view.name,
        summary: `Create ${view.type.toLowerCase()} view "${view.name}" on ${objectName}`,
        payload: { kind: 'createView', view },
      });
      continue;
    }
    const adopt = existing.managedByApp !== app && !existing.isDefault;
    const details = [...compareView(existing, view), ...(adopt ? ['now managed by this app'] : [])];
    if (details.length) {
      add({
        kind: 'updateView',
        object: objectName,
        view: view.name,
        summary: `Update view "${view.name}" on ${objectName}`,
        details,
        payload: { kind: 'updateView', viewId: existing.id, view, adopt },
      });
    }
  }
  // Views of removed objects go with them, so they aren't listed separately.
  const removedObjects = new Set(
    changes.filter((c) => c.kind === 'removeObject').map((c) => c.object),
  );
  for (const v of current.views) {
    if (
      v.managedByApp === app &&
      !declaredViews.has(`${v.objectName}/${v.name}`) &&
      !removedObjects.has(v.objectName)
    ) {
      add({
        kind: 'removeView',
        object: v.objectName,
        view: v.name,
        summary: `Remove view "${v.name}" on ${v.objectName}`,
        payload: { kind: 'removeView', viewId: v.id },
      });
    }
  }

  changes.sort((a, b) => {
    const order = ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
    if (order) return order;
    // Plain fields before relations, so relation targets in the same object exist first.
    const rel = (c: PlanChange) =>
      c.payload.kind === 'createField' && c.payload.input.type === FieldType.RELATION ? 1 : 0;
    return rel(a) - rel(b);
  });
  return { app, changes, errors };
}

export interface ApplyResult {
  app: string;
  dryRun: boolean;
  applied: boolean;
  changes: Omit<PlanChange, 'payload'>[];
  errors: string[];
}
