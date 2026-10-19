import { FieldSettings, FieldType, SelectOption } from '@crm-replica/shared';
import { ColumnSpec, columnsForField } from '../schema-sync/column-mapping';
import type { FieldMetadataEntity } from '../metadata/field-metadata.entity';
import type { ObjectMetadataEntity } from '../metadata/object-metadata.entity';

/** System columns that look like fields to filters, sorts and responses. */
export type SystemFieldKind = 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'position';

export interface FieldModel {
  /** Metadata id (undefined for system fields). */
  id?: string;
  /** API name, e.g. `company`. */
  name: string;
  /** Key in record JSON: the name, or `<name>Id` for relations (`companyId`). */
  apiKey: string;
  label: string;
  type: FieldType;
  columns: ColumnSpec[];
  isRequired: boolean;
  defaultValue: unknown;
  options: SelectOption[] | null;
  settings: FieldSettings | null;
  system?: SystemFieldKind;
  /** For relations: the target object's nameSingular. */
  relationTarget?: string;
}

export interface InverseRelationModel {
  /** e.g. `people` on Company. */
  name: string;
  label: string;
  sourceObject: string;
  sourceField: FieldModel;
}

export interface ObjectModel {
  id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  tableName: string;
  isSystem: boolean;
  labelIdentifierFieldName: string | null;
  /** Active fields only, in position order. */
  fields: FieldModel[];
  systemFields: FieldModel[];
  inverseRelations: InverseRelationModel[];
}

export interface WorkspaceModel {
  schema: string;
  objects: ObjectModel[];
}

const systemField = (
  name: SystemFieldKind,
  column: string,
  type: FieldType,
  sqlType: string,
  label: string,
): FieldModel => ({
  name,
  apiKey: name,
  label,
  type,
  columns: [{ column, sqlType }],
  isRequired: false,
  defaultValue: null,
  options: null,
  settings: null,
  system: name,
});

/** id and createdBy behave like relations (uuid), createdAt/updatedAt like dates, position like a number. */
export const SYSTEM_FIELDS: FieldModel[] = [
  systemField('id', 'id', FieldType.RELATION, 'uuid', 'ID'),
  systemField('createdAt', 'created_at', FieldType.DATE_TIME, 'timestamptz', 'Created at'),
  systemField('updatedAt', 'updated_at', FieldType.DATE_TIME, 'timestamptz', 'Updated at'),
  systemField('createdBy', 'created_by', FieldType.RELATION, 'uuid', 'Created by'),
  systemField('position', 'position', FieldType.NUMBER, 'double precision', 'Position'),
];

function toFieldModel(field: FieldMetadataEntity, objects: ObjectMetadataEntity[]): FieldModel {
  const target = field.relationTargetObjectId
    ? objects.find((o) => o.id === field.relationTargetObjectId)
    : undefined;
  return {
    id: field.id,
    name: field.name,
    apiKey: field.type === FieldType.RELATION ? `${field.name}Id` : field.name,
    label: field.label,
    type: field.type,
    columns: columnsForField(field.name, field.type),
    isRequired: field.isRequired,
    defaultValue: field.defaultValue ?? null,
    options: field.options,
    settings: field.settings,
    relationTarget: target?.nameSingular,
  };
}

/** Builds the live (non-deleted) data model of a workspace from its metadata rows. */
export function buildWorkspaceModel(
  schema: string,
  entities: ObjectMetadataEntity[],
): WorkspaceModel {
  const live = entities.filter((o) => !o.deletedAt);
  const liveField = (f: FieldMetadataEntity) =>
    !f.deletedAt &&
    (!f.relationTargetObjectId || live.some((o) => o.id === f.relationTargetObjectId));

  const objects: ObjectModel[] = live.map((o) => ({
    id: o.id,
    nameSingular: o.nameSingular,
    namePlural: o.namePlural,
    labelSingular: o.labelSingular,
    labelPlural: o.labelPlural,
    tableName: o.tableName,
    isSystem: o.isSystem,
    labelIdentifierFieldName: o.labelIdentifierFieldName,
    fields: [...o.fields]
      .filter(liveField)
      .sort((a, b) => a.position - b.position)
      .map((f) => toFieldModel(f, live)),
    systemFields: SYSTEM_FIELDS,
    inverseRelations: [],
  }));

  for (const source of objects) {
    const entity = live.find((o) => o.id === source.id)!;
    for (const field of source.fields.filter((f) => f.relationTarget)) {
      const target = objects.find((o) => o.nameSingular === field.relationTarget)!;
      const meta = entity.fields.find((f) => f.name === field.name)!;
      target.inverseRelations.push({
        name: meta.relationInverseName!,
        label: meta.relationInverseLabel!,
        sourceObject: source.nameSingular,
        sourceField: field,
      });
    }
  }
  return { schema, objects };
}

/** Finds a field (or system field) by its name or record key (`company` or `companyId`). */
export function findField(object: ObjectModel, name: string): FieldModel | undefined {
  return (
    object.systemFields.find((f) => f.name === name) ??
    object.fields.find((f) => f.name === name || f.apiKey === name)
  );
}
