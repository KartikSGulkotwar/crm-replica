import type { FieldType } from '../field-type';
import type { RelationOnDelete } from './field-types';
import type { FieldSettings, SelectOption } from './schemas';

export interface FieldRelationDto {
  targetObjectId: string;
  targetObjectName: string;
  inverseName: string;
  inverseLabel: string;
  onDelete: RelationOnDelete;
}

export interface FieldMetadataDto {
  id: string;
  objectId: string;
  name: string;
  label: string;
  type: FieldType;
  description: string | null;
  /** False for fields that come with a standard object. */
  isCustom: boolean;
  isRequired: boolean;
  defaultValue: unknown;
  options: SelectOption[] | null;
  settings: FieldSettings | null;
  relation: FieldRelationDto | null;
  position: number;
  /** Set when soft-deleted: the column still exists until permanently deleted. */
  deletedAt: string | null;
}

/** The reverse side of a relation, e.g. Company → people (from Person.company). */
export interface InverseRelationDto {
  name: string;
  label: string;
  sourceObjectId: string;
  sourceObjectName: string;
  sourceFieldId: string;
  sourceFieldName: string;
}

export interface ObjectMetadataDto {
  id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description: string | null;
  icon: string | null;
  isCustom: boolean;
  /** Internal objects (e.g. workspace members) hidden from the sidebar and read-only. */
  isSystem: boolean;
  labelIdentifierFieldName: string | null;
  position: number;
  deletedAt: string | null;
  fields: FieldMetadataDto[];
  inverseRelations: InverseRelationDto[];
}

/** GET /api/metadata/export */
export interface MetadataExport {
  version: 1;
  exportedAt: string;
  objects: ObjectMetadataDto[];
}
