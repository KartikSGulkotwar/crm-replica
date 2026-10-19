import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  camelToSnake,
  createObjectSchema,
  defaultValueError,
  FieldMetadataDto,
  FieldType,
  MetadataExport,
  NormalizedFieldInput,
  normalizeOptions,
  ObjectMetadataDto,
  SYSTEM_FIELD_NAMES,
  UpdateFieldInput,
  UpdateObjectInput,
} from '@crm-replica/shared';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { columnsForField, SYSTEM_COLUMNS } from '../schema-sync/column-mapping';
import { SchemaSyncService } from '../schema-sync/schema-sync.service';
import { FieldMetadataEntity } from './field-metadata.entity';
import { ObjectMetadataEntity } from './object-metadata.entity';

export type NormalizedObjectInput = z.output<typeof createObjectSchema>;

/** The parts of a workspace this service needs. */
export interface WorkspaceRef {
  id: string;
  schemaName: string;
}

interface CreateObjectOptions {
  isCustom?: boolean;
  /** The app (objects-as-code) creating it; also set on the fields listed in the input. */
  managedByApp?: string | null;
  isSystem?: boolean;
  position?: number;
  em?: EntityManager;
}

/** Field types that can serve as a record's title. */
const LABEL_IDENTIFIER_TYPES = [FieldType.TEXT, FieldType.EMAIL, FieldType.PHONE, FieldType.LINK];

const DEFAULT_FIELDS: NormalizedFieldInput[] = [
  {
    name: 'name',
    label: 'Name',
    type: FieldType.TEXT,
    description: null,
    isRequired: false,
    defaultValue: null,
    options: null,
    settings: null,
    relation: null,
  },
];

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Objects and fields as data. Every change runs in one transaction together with the matching
 * DDL from SchemaSyncService, behind a per-workspace lock so concurrent edits can't race.
 */
@Injectable()
export class MetadataService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly schemaSync: SchemaSyncService,
  ) {}

  // ---------------------------------------------------------------- reads

  async listObjects(
    workspaceId: string,
    opts: { includeDeleted?: boolean; em?: EntityManager } = {},
  ): Promise<ObjectMetadataDto[]> {
    const all = await this.loadAll(opts.em ?? this.dataSource.manager, workspaceId);
    return all
      .filter((o) => opts.includeDeleted || !o.deletedAt)
      .map((o) => toObjectDto(o, all, opts.includeDeleted ?? false));
  }

  async getObject(workspaceId: string, idOrName: string): Promise<ObjectMetadataDto> {
    const all = await this.loadAll(this.dataSource.manager, workspaceId);
    const object = all.find((o) =>
      isUuid(idOrName)
        ? o.id === idOrName
        : o.nameSingular === idOrName || o.namePlural === idOrName,
    );
    if (!object) throw new NotFoundException(`Object "${idOrName}" not found`);
    return toObjectDto(object, all, Boolean(object.deletedAt));
  }

  async export(workspaceId: string): Promise<MetadataExport> {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      objects: await this.listObjects(workspaceId),
    };
  }

  // -------------------------------------------------------------- objects

  async createObject(
    workspace: WorkspaceRef,
    input: NormalizedObjectInput,
    opts: CreateObjectOptions = {},
  ): Promise<ObjectMetadataDto> {
    return this.tx(workspace.id, opts.em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      for (const name of [input.nameSingular, input.namePlural]) {
        if (all.some((o) => o.nameSingular === name || o.namePlural === name)) {
          throw new ConflictException(`An object named "${name}" already exists`);
        }
      }
      const tableName = camelToSnake(input.namePlural);
      if (all.some((o) => o.tableName === tableName)) {
        throw new ConflictException(
          `An object using the name "${input.namePlural}" already exists`,
        );
      }

      const fields = input.fields?.length ? input.fields : DEFAULT_FIELDS;
      const labelIdentifier =
        input.labelIdentifierFieldName ??
        (fields.some((f) => f.name === 'name')
          ? 'name'
          : fields.find((f) => f.type === FieldType.TEXT)?.name) ??
        null;
      if (labelIdentifier) {
        const field = fields.find((f) => f.name === labelIdentifier);
        if (!field || !LABEL_IDENTIFIER_TYPES.includes(field.type)) {
          throw new BadRequestException(
            `labelIdentifierFieldName "${labelIdentifier}" must be one of the object's text fields`,
          );
        }
      }

      const object = await em.save(
        em.create(ObjectMetadataEntity, {
          workspaceId: workspace.id,
          nameSingular: input.nameSingular,
          namePlural: input.namePlural,
          labelSingular: input.labelSingular,
          labelPlural: input.labelPlural,
          description: input.description ?? null,
          icon: input.icon ?? null,
          tableName,
          isCustom: opts.isCustom ?? true,
          isSystem: opts.isSystem ?? false,
          labelIdentifierFieldName: labelIdentifier,
          managedByApp: opts.managedByApp ?? null,
          position:
            opts.position ??
            Math.max(-1, ...all.filter((o) => !o.isSystem).map((o) => o.position)) + 1,
        }),
      );
      await this.schemaSync.createTable(em, workspace.schemaName, tableName);
      for (const field of fields) {
        // The default "name" field (when none were given) isn't managed by the app.
        const managed = input.fields?.length ? (opts.managedByApp ?? null) : null;
        await this.addField(em, workspace, object.id, field, opts.isCustom ?? true, managed);
      }
      return this.getObjectIn(em, workspace.id, object.id);
    });
  }

  async updateObject(
    workspace: WorkspaceRef,
    objectId: string,
    input: UpdateObjectInput,
    em?: EntityManager,
  ): Promise<ObjectMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const object = this.findActiveObject(all, objectId);
      if (object.isSystem) throw new BadRequestException('System objects can’t be changed');
      if (input.labelIdentifierFieldName !== undefined) {
        const field = object.fields.find(
          (f) => f.name === input.labelIdentifierFieldName && !f.deletedAt,
        );
        if (!field || !LABEL_IDENTIFIER_TYPES.includes(field.type)) {
          throw new BadRequestException('The record title must be one of the object’s text fields');
        }
        object.labelIdentifierFieldName = field.name;
      }
      if (input.labelSingular !== undefined) object.labelSingular = input.labelSingular;
      if (input.labelPlural !== undefined) object.labelPlural = input.labelPlural;
      if (input.description !== undefined) object.description = input.description ?? null;
      if (input.icon !== undefined) object.icon = input.icon ?? null;
      if (input.position !== undefined) object.position = input.position;
      await em.save(ObjectMetadataEntity, stripRelations(object));
      return this.getObjectIn(em, workspace.id, object.id);
    });
  }

  /**
   * Step 1 of deleting: hides the object (and relation fields pointing at it) but keeps the
   * table and data, so it can be restored. `destroyObject` removes it for good.
   */
  async softDeleteObject(
    workspace: WorkspaceRef,
    objectId: string,
    em?: EntityManager,
  ): Promise<ObjectMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const object = this.findActiveObject(all, objectId);
      if (!object.isCustom) throw new BadRequestException('Standard objects can’t be deleted');
      const now = new Date();
      object.deletedAt = now;
      await em.save(ObjectMetadataEntity, stripRelations(object));
      const incoming = incomingRelations(all, object.id).filter(
        (f) => !f.deletedAt && f.objectId !== object.id,
      );
      for (const field of incoming) {
        field.deletedAt = now;
        await em.save(FieldMetadataEntity, field);
      }
      return this.getObjectIn(em, workspace.id, object.id);
    });
  }

  async restoreObject(
    workspace: WorkspaceRef,
    objectId: string,
    em?: EntityManager,
  ): Promise<ObjectMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const object = this.findObject(all, objectId);
      if (!object.deletedAt) throw new BadRequestException('This object isn’t deleted');
      const deletedAt = object.deletedAt.getTime();
      object.deletedAt = null;
      await em.save(ObjectMetadataEntity, stripRelations(object));
      // Bring back the relation fields that were hidden together with this object.
      for (const field of incomingRelations(all, object.id)) {
        const owner = all.find((o) => o.id === field.objectId);
        if (field.deletedAt?.getTime() === deletedAt && owner && !owner.deletedAt) {
          field.deletedAt = null;
          await em.save(FieldMetadataEntity, field);
        }
      }
      return this.getObjectIn(em, workspace.id, object.id);
    });
  }

  /** Step 2: drops the table, its data and every relation field pointing at it. Irreversible. */
  async destroyObject(
    workspace: WorkspaceRef,
    objectId: string,
    em?: EntityManager,
  ): Promise<void> {
    await this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const object = this.findObject(all, objectId);
      if (!object.deletedAt)
        throw new BadRequestException(
          'Delete the object first; then it can be removed permanently',
        );
      for (const field of incomingRelations(all, object.id).filter(
        (f) => f.objectId !== object.id,
      )) {
        const owner = all.find((o) => o.id === field.objectId)!;
        await this.schemaSync.dropField(em, workspace.schemaName, owner.tableName, field);
        await em.delete(FieldMetadataEntity, { id: field.id });
      }
      await this.schemaSync.dropTable(em, workspace.schemaName, object.tableName);
      await em.delete(ObjectMetadataEntity, { id: object.id });
    });
  }

  // --------------------------------------------------------------- fields

  async createField(
    workspace: WorkspaceRef,
    objectId: string,
    input: NormalizedFieldInput,
    opts: { em?: EntityManager; managedByApp?: string | null } = {},
  ): Promise<FieldMetadataDto> {
    return this.tx(workspace.id, opts.em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const object = this.findActiveObject(all, objectId);
      if (object.isSystem) throw new BadRequestException('System objects can’t get custom fields');
      const field = await this.addField(
        em,
        workspace,
        object.id,
        input,
        true,
        opts.managedByApp ?? null,
      );
      return this.getFieldIn(em, workspace.id, field.id);
    });
  }

  async updateField(
    workspace: WorkspaceRef,
    fieldId: string,
    input: UpdateFieldInput,
    em?: EntityManager,
  ): Promise<FieldMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const { field, object } = this.findActiveField(all, fieldId);
      if (object.isSystem) throw new BadRequestException('System objects can’t be changed');
      const isSelect = field.type === FieldType.SELECT || field.type === FieldType.MULTI_SELECT;

      if (input.label !== undefined) field.label = input.label;
      if (input.description !== undefined) field.description = input.description ?? null;
      if (input.isRequired !== undefined) field.isRequired = input.isRequired;

      if (input.options !== undefined) {
        if (!isSelect) throw new BadRequestException('Only select fields have options');
        const previous = field.options ?? [];
        const options = normalizeOptions(input.options, previous);
        const values = options.map((o) => o.value);
        if (new Set(values).size !== values.length)
          throw new BadRequestException('Option values must be unique');
        const removed = previous.map((o) => o.value).filter((v) => !values.includes(v));
        await this.schemaSync.clearRemovedOptions(
          em,
          workspace.schemaName,
          object.tableName,
          field,
          removed,
        );
        // A default pointing at a removed option no longer makes sense.
        if (field.type === FieldType.SELECT && removed.includes(field.defaultValue as string))
          field.defaultValue = null;
        if (field.type === FieldType.MULTI_SELECT && Array.isArray(field.defaultValue)) {
          field.defaultValue = (field.defaultValue as string[]).filter((v) => values.includes(v));
        }
        field.options = options;
      }

      if (input.settings !== undefined) {
        if (input.settings.max !== undefined && field.type !== FieldType.RATING) {
          throw new BadRequestException('Only rating fields have a maximum');
        }
        if (input.settings.currency !== undefined && field.type !== FieldType.CURRENCY) {
          throw new BadRequestException('Only currency fields have a currency');
        }
        const oldMax = field.settings?.max ?? 5;
        field.settings = { ...field.settings, ...input.settings };
        const newMax = field.settings.max ?? 5;
        if (field.type === FieldType.RATING && newMax < oldMax) {
          await this.schemaSync.capRating(
            em,
            workspace.schemaName,
            object.tableName,
            field,
            newMax,
          );
          if (typeof field.defaultValue === 'number' && field.defaultValue > newMax)
            field.defaultValue = newMax;
        }
      }

      if (input.relation?.inverseLabel !== undefined) {
        if (field.type !== FieldType.RELATION)
          throw new BadRequestException('Only relation fields have a reverse label');
        field.relationInverseLabel = input.relation.inverseLabel;
      }

      if (input.defaultValue !== undefined) field.defaultValue = input.defaultValue;
      const error = defaultValueError(
        field.type,
        field.defaultValue,
        field.options,
        field.settings,
      );
      if (error) throw new BadRequestException(`defaultValue: ${error}`);

      await em.save(FieldMetadataEntity, field);
      return this.getFieldIn(em, workspace.id, field.id);
    });
  }

  /** Hides the field; the column and its data stay until `destroyField`. */
  async softDeleteField(
    workspace: WorkspaceRef,
    fieldId: string,
    em?: EntityManager,
  ): Promise<FieldMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const { field, object } = this.findActiveField(all, fieldId);
      if (!field.isCustom) throw new BadRequestException('Standard fields can’t be deleted');
      if (object.labelIdentifierFieldName === field.name) {
        throw new BadRequestException(
          'This field is the record title; choose another title field first',
        );
      }
      field.deletedAt = new Date();
      await em.save(FieldMetadataEntity, field);
      return this.getFieldIn(em, workspace.id, field.id);
    });
  }

  async restoreField(
    workspace: WorkspaceRef,
    fieldId: string,
    em?: EntityManager,
  ): Promise<FieldMetadataDto> {
    return this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const { field, object } = this.findField(all, fieldId);
      if (!field.deletedAt) throw new BadRequestException('This field isn’t deleted');
      if (object.deletedAt) throw new BadRequestException('Restore the object first');
      if (
        field.relationTargetObjectId &&
        all.find((o) => o.id === field.relationTargetObjectId)?.deletedAt
      ) {
        throw new BadRequestException(
          'The object this field links to is deleted; restore it first',
        );
      }
      field.deletedAt = null;
      await em.save(FieldMetadataEntity, field);
      return this.getFieldIn(em, workspace.id, field.id);
    });
  }

  /** Drops the column and its data. Irreversible. */
  async destroyField(workspace: WorkspaceRef, fieldId: string, em?: EntityManager): Promise<void> {
    await this.tx(workspace.id, em, async (em) => {
      const all = await this.loadAll(em, workspace.id);
      const { field, object } = this.findField(all, fieldId);
      if (!field.deletedAt)
        throw new BadRequestException('Delete the field first; then it can be removed permanently');
      await this.schemaSync.dropField(em, workspace.schemaName, object.tableName, field);
      await em.delete(FieldMetadataEntity, { id: field.id });
    });
  }

  /** Marks an object or field as managed by an app (used when an app adopts what already exists). */
  async setManagedBy(
    em: EntityManager,
    target: 'object' | 'field',
    id: string,
    app: string | null,
  ): Promise<void> {
    await em.update(
      target === 'object' ? ObjectMetadataEntity : FieldMetadataEntity,
      { id },
      { managedByApp: app },
    );
  }

  // ------------------------------------------------------------ internals

  /** Validates names and columns against everything already on the object, then adds the column(s). */
  private async addField(
    em: EntityManager,
    workspace: WorkspaceRef,
    objectId: string,
    input: NormalizedFieldInput,
    isCustom: boolean,
    managedByApp: string | null = null,
  ): Promise<FieldMetadataEntity> {
    const all = await this.loadAll(em, workspace.id);
    const object = this.findActiveObject(all, objectId);

    if (namesInUse(object, all).has(input.name)) {
      throw new ConflictException(
        `A field named "${input.name}" already exists on ${object.labelSingular}`,
      );
    }
    const usedColumns = new Set([
      ...SYSTEM_COLUMNS,
      ...object.fields.flatMap((f) => columnsForField(f.name, f.type).map((c) => c.column)),
    ]);
    const clash = columnsForField(input.name, input.type).find((c) => usedColumns.has(c.column));
    if (clash) {
      throw new ConflictException(
        `"${input.name}" clashes with an existing field on ${object.labelSingular}; choose another name`,
      );
    }

    let target: ObjectMetadataEntity | undefined;
    let inverseName: string | null = null;
    if (input.relation) {
      target = all.find((o) => o.nameSingular === input.relation!.targetObject && !o.deletedAt);
      if (!target) throw new BadRequestException(`Unknown object "${input.relation.targetObject}"`);
      inverseName = input.relation.inverseName ?? object.namePlural;
      const taken = namesInUse(target, all);
      if (target.id === object.id) taken.add(input.name);
      if (taken.has(inverseName)) {
        throw new ConflictException(
          `"${inverseName}" is already used on ${target.labelSingular}; set relation.inverseName to another name`,
        );
      }
    }

    const field = await em.save(
      em.create(FieldMetadataEntity, {
        workspaceId: workspace.id,
        objectId: object.id,
        name: input.name,
        label: input.label,
        type: input.type,
        description: input.description,
        isCustom,
        isRequired: input.isRequired,
        defaultValue: input.defaultValue,
        options: input.options,
        settings: input.settings,
        relationTargetObjectId: target?.id ?? null,
        relationInverseName: inverseName,
        relationInverseLabel: input.relation
          ? (input.relation.inverseLabel ?? object.labelPlural)
          : null,
        relationOnDelete: input.relation?.onDelete ?? null,
        managedByApp,
        position: Math.max(-1, ...object.fields.map((f) => f.position)) + 1,
      }),
    );
    await this.schemaSync.addField(
      em,
      workspace.schemaName,
      object.tableName,
      field,
      target && { table: target.tableName, onDelete: input.relation!.onDelete },
    );
    return field;
  }

  /** Runs `fn` in a transaction (or the caller's), holding this workspace's metadata lock. */
  /** Holds this workspace's metadata lock until the surrounding transaction ends. */
  async lock(em: EntityManager, workspaceId: string): Promise<void> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`metadata:${workspaceId}`]);
  }

  private async tx<T>(
    workspaceId: string,
    em: EntityManager | undefined,
    fn: (em: EntityManager) => Promise<T>,
  ) {
    const run = async (m: EntityManager) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`metadata:${workspaceId}`]);
      return fn(m);
    };
    return em ? run(em) : this.dataSource.transaction(run);
  }

  private async loadAll(em: EntityManager, workspaceId: string): Promise<ObjectMetadataEntity[]> {
    const objects = await em.find(ObjectMetadataEntity, {
      where: { workspaceId },
      relations: { fields: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    for (const o of objects) o.fields.sort((a, b) => a.position - b.position);
    return objects;
  }

  private async getObjectIn(em: EntityManager, workspaceId: string, objectId: string) {
    const all = await this.loadAll(em, workspaceId);
    const object = this.findObject(all, objectId);
    return toObjectDto(object, all, Boolean(object.deletedAt));
  }

  private async getFieldIn(em: EntityManager, workspaceId: string, fieldId: string) {
    const all = await this.loadAll(em, workspaceId);
    return toFieldDto(this.findField(all, fieldId).field, all);
  }

  private findObject(all: ObjectMetadataEntity[], id: string) {
    const object = isUuid(id) ? all.find((o) => o.id === id) : undefined;
    if (!object) throw new NotFoundException('Object not found');
    return object;
  }

  private findActiveObject(all: ObjectMetadataEntity[], id: string) {
    const object = this.findObject(all, id);
    if (object.deletedAt) throw new BadRequestException('This object is deleted; restore it first');
    return object;
  }

  private findField(all: ObjectMetadataEntity[], id: string) {
    for (const object of all) {
      const field = object.fields.find((f) => f.id === id);
      if (field) return { field, object };
    }
    throw new NotFoundException('Field not found');
  }

  private findActiveField(all: ObjectMetadataEntity[], id: string) {
    const found = this.findField(all, id);
    if (found.field.deletedAt)
      throw new BadRequestException('This field is deleted; restore it first');
    if (found.object.deletedAt)
      throw new BadRequestException('This object is deleted; restore it first');
    return found;
  }
}

/** Relation fields (on any object) that point at `objectId`. */
function incomingRelations(all: ObjectMetadataEntity[], objectId: string): FieldMetadataEntity[] {
  return all.flatMap((o) => o.fields).filter((f) => f.relationTargetObjectId === objectId);
}

/** Names a new field on `object` can't use: its fields (even deleted), reverse relations and system fields. */
function namesInUse(object: ObjectMetadataEntity, all: ObjectMetadataEntity[]): Set<string> {
  return new Set<string>([
    ...SYSTEM_FIELD_NAMES,
    ...object.fields.map((f) => f.name),
    ...incomingRelations(all, object.id).map((f) => f.relationInverseName!),
  ]);
}

/** Saves only the object's own columns (not its loaded `fields`). */
function stripRelations(object: ObjectMetadataEntity): ObjectMetadataEntity {
  const { fields: _fields, ...rest } = object;
  return rest as ObjectMetadataEntity;
}

function toFieldDto(field: FieldMetadataEntity, all: ObjectMetadataEntity[]): FieldMetadataDto {
  const target = field.relationTargetObjectId
    ? all.find((o) => o.id === field.relationTargetObjectId)
    : undefined;
  return {
    id: field.id,
    objectId: field.objectId,
    name: field.name,
    label: field.label,
    type: field.type,
    description: field.description,
    isCustom: field.isCustom,
    isRequired: field.isRequired,
    defaultValue: field.defaultValue ?? null,
    options: field.options,
    settings: field.settings,
    relation: target
      ? {
          targetObjectId: target.id,
          targetObjectName: target.nameSingular,
          inverseName: field.relationInverseName!,
          inverseLabel: field.relationInverseLabel!,
          onDelete: field.relationOnDelete!,
        }
      : null,
    position: field.position,
    managedByApp: field.managedByApp ?? null,
    deletedAt: field.deletedAt?.toISOString() ?? null,
  };
}

function toObjectDto(
  object: ObjectMetadataEntity,
  all: ObjectMetadataEntity[],
  includeDeleted: boolean,
): ObjectMetadataDto {
  const isLive = (f: FieldMetadataEntity) => includeDeleted || !f.deletedAt;
  return {
    id: object.id,
    nameSingular: object.nameSingular,
    namePlural: object.namePlural,
    labelSingular: object.labelSingular,
    labelPlural: object.labelPlural,
    description: object.description,
    icon: object.icon,
    isCustom: object.isCustom,
    isSystem: object.isSystem,
    labelIdentifierFieldName: object.labelIdentifierFieldName,
    position: object.position,
    managedByApp: object.managedByApp ?? null,
    deletedAt: object.deletedAt?.toISOString() ?? null,
    fields: object.fields.filter(isLive).map((f) => toFieldDto(f, all)),
    inverseRelations: incomingRelations(all, object.id)
      .filter((f) => !f.deletedAt)
      .map((f) => {
        const source = all.find((o) => o.id === f.objectId)!;
        return { source, f };
      })
      .filter(({ source }) => !source.deletedAt)
      .map(({ source, f }) => ({
        name: f.relationInverseName!,
        label: f.relationInverseLabel!,
        sourceObjectId: source.id,
        sourceObjectName: source.nameSingular,
        sourceFieldId: f.id,
        sourceFieldName: f.name,
      })),
  };
}
