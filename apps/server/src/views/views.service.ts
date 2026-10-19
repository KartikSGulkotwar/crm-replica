import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createViewSchema,
  FieldType,
  serializeSort,
  updateViewSchema,
  ViewDto,
  ViewType,
} from '@crm-replica/shared';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { buildFilterSql, FilterError } from '../records/filter-builder';
import { ObjectModel, WorkspaceModel } from '../records/object-model';
import { parseSortParam } from '../records/sort-cursor';
import { SqlParams } from '../records/sql-params';
import { WorkspaceModelService } from '../records/workspace-model.service';
import { ViewEntity, ViewFieldEntity, ViewFilterEntity, ViewSortEntity } from './view.entities';

type CreateView = z.output<typeof createViewSchema>;
type UpdateView = z.output<typeof updateViewSchema>;
interface WorkspaceRef {
  id: string;
  schemaName: string;
}

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Saved views. They're shared by everyone in the workspace (they aren't part of the data
 * model, so members can create and change them). Every object has one default view.
 */
@Injectable()
export class ViewsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly models: WorkspaceModelService,
  ) {}

  async list(workspace: WorkspaceRef, objectRef: string): Promise<ViewDto[]> {
    const model = await this.models.load(workspace);
    const object = this.findObject(model, objectRef);
    await this.ensureDefault(workspace.id, object);
    const views = await this.dataSource.getRepository(ViewEntity).find({
      where: { workspaceId: workspace.id, objectId: object.id },
      relations: { fields: true, filters: true, sorts: true },
      order: { isDefault: 'DESC', position: 'ASC', createdAt: 'ASC' },
    });
    return views.map((v) => toDto(v, object));
  }

  async get(workspace: WorkspaceRef, id: string): Promise<ViewDto> {
    const { view, object } = await this.load(workspace, id);
    return toDto(view, object);
  }

  async create(workspace: WorkspaceRef, userId: string, input: CreateView): Promise<ViewDto> {
    const model = await this.models.load(workspace);
    const object = this.findObject(model, input.object);
    await this.ensureDefault(workspace.id, object);
    const id = await this.dataSource.transaction(async (em) => {
      const count = await em.countBy(ViewEntity, { objectId: object.id });
      const view = await em.save(
        em.create(ViewEntity, {
          workspaceId: workspace.id,
          objectId: object.id,
          name: input.name,
          type: input.type,
          filterConjunction: input.filterConjunction,
          kanbanFieldId: null,
          isDefault: false,
          position: count,
          createdBy: userId,
        }),
      );
      await this.apply(em, view, object, {
        kanbanFieldName: input.kanbanFieldName,
        fields: input.fields,
        filters: input.filters,
        sorts: input.sorts,
      });
      return view.id;
    });
    return this.get(workspace, id);
  }

  async update(workspace: WorkspaceRef, id: string, input: UpdateView): Promise<ViewDto> {
    const { view, object } = await this.load(workspace, id);
    await this.dataSource.transaction(async (em) => {
      if (input.name !== undefined) view.name = input.name;
      if (input.type !== undefined) view.type = input.type;
      if (input.filterConjunction !== undefined) view.filterConjunction = input.filterConjunction;
      if (input.position !== undefined) view.position = input.position;
      await this.apply(em, view, object, input);
    });
    return this.get(workspace, id);
  }

  async remove(workspace: WorkspaceRef, id: string): Promise<void> {
    const { view } = await this.load(workspace, id);
    if (view.isDefault) throw new BadRequestException('The default view can’t be deleted');
    await this.dataSource.getRepository(ViewEntity).delete({ id: view.id });
  }

  /** Validates and writes the parts of a view that reference fields, then saves it. */
  private async apply(
    em: EntityManager,
    view: ViewEntity,
    object: ObjectModel,
    input: Pick<UpdateView, 'kanbanFieldName' | 'fields' | 'filters' | 'sorts'>,
  ) {
    if (input.kanbanFieldName !== undefined) {
      if (input.kanbanFieldName === null) view.kanbanFieldId = null;
      else {
        const field = object.fields.find((f) => f.name === input.kanbanFieldName);
        if (!field || field.type !== FieldType.SELECT) {
          throw new BadRequestException('Kanban columns must come from a select field');
        }
        view.kanbanFieldId = field.id!;
      }
    }
    if (view.type === ViewType.KANBAN && !view.kanbanFieldId) {
      const first = object.fields.find((f) => f.type === FieldType.SELECT);
      if (!first)
        throw new BadRequestException(
          `${object.labelPlural} have no select field to group a kanban by`,
        );
      view.kanbanFieldId = first.id!;
    }
    const { fields: _f, filters: _fi, sorts: _s, ...columns } = view;
    await em.save(ViewEntity, columns);

    if (input.fields !== undefined) {
      const names = input.fields.map((f) => f.fieldName);
      if (new Set(names).size !== names.length)
        throw new BadRequestException('Each field can appear only once');
      const rows = input.fields.map((f, position) => {
        const field = object.fields.find((x) => x.name === f.fieldName);
        if (!field)
          throw new BadRequestException(
            `Unknown field "${f.fieldName}" on ${object.labelSingular}`,
          );
        return em.create(ViewFieldEntity, {
          viewId: view.id,
          fieldId: field.id!,
          isVisible: f.isVisible,
          width: f.width,
          position,
        });
      });
      await em.delete(ViewFieldEntity, { viewId: view.id });
      await em.save(rows);
    }

    if (input.filters !== undefined) {
      try {
        // Same validation as the records API, so a saved view can never hold an invalid filter.
        if (input.filters.length) {
          buildFilterSql(
            object,
            {
              and: input.filters.map((f) => ({
                field: f.fieldName,
                op: f.operator,
                value: f.value,
              })),
            },
            new SqlParams(),
          );
        }
      } catch (error) {
        if (error instanceof FilterError) throw new BadRequestException(error.message);
        throw error;
      }
      await em.delete(ViewFilterEntity, { viewId: view.id });
      await em.save(
        input.filters.map((f, position) =>
          em.create(ViewFilterEntity, {
            viewId: view.id,
            fieldName: f.fieldName,
            operator: f.operator,
            value: f.value ?? null,
            position,
          }),
        ),
      );
    }

    if (input.sorts !== undefined) {
      try {
        if (input.sorts.length)
          parseSortParam(
            object,
            serializeSort(input.sorts.map((s) => ({ field: s.fieldName, direction: s.direction }))),
          );
      } catch (error) {
        if (error instanceof FilterError) throw new BadRequestException(error.message);
        throw error;
      }
      await em.delete(ViewSortEntity, { viewId: view.id });
      await em.save(
        input.sorts.map((s, position) =>
          em.create(ViewSortEntity, {
            viewId: view.id,
            fieldName: s.fieldName,
            direction: s.direction,
            position,
          }),
        ),
      );
    }
  }

  /** Creates the object's default "All …" view the first time it's needed. */
  private async ensureDefault(workspaceId: string, object: ObjectModel) {
    await this.dataSource.query(
      `INSERT INTO core.view (workspace_id, object_id, name, type, is_default, position)
       VALUES ($1, $2, $3, 'TABLE', true, 0)
       ON CONFLICT (object_id) WHERE is_default DO NOTHING`,
      [workspaceId, object.id, `All ${object.labelPlural.toLowerCase()}`],
    );
  }

  private async load(workspace: WorkspaceRef, id: string) {
    if (!isUuid(id)) throw new NotFoundException('View not found');
    const view = await this.dataSource.getRepository(ViewEntity).findOne({
      where: { id, workspaceId: workspace.id },
      relations: { fields: true, filters: true, sorts: true },
    });
    if (!view) throw new NotFoundException('View not found');
    const model = await this.models.load(workspace);
    const object = model.objects.find((o) => o.id === view.objectId);
    if (!object) throw new NotFoundException('This view’s object was deleted');
    return { view, object };
  }

  private findObject(model: WorkspaceModel, ref: string): ObjectModel {
    const object = model.objects.find(
      (o) => o.id === ref || o.namePlural === ref || o.nameSingular === ref,
    );
    if (!object) throw new NotFoundException(`Object "${ref}" not found`);
    return object;
  }
}

/**
 * The view as the UI needs it. Fields added to the object after the view was saved appear at
 * the end; filters and sorts on fields that no longer exist are dropped.
 */
function toDto(view: ViewEntity, object: ObjectModel): ViewDto {
  const known = new Set([
    ...object.fields.map((f) => f.name),
    ...object.systemFields.map((f) => f.name),
  ]);
  const stored = [...view.fields]
    .sort((a, b) => a.position - b.position)
    .map((vf) => ({ vf, field: object.fields.find((f) => f.id === vf.fieldId) }))
    .filter((x) => x.field);
  const fields = [
    ...stored.map(({ vf, field }) => ({
      fieldName: field!.name,
      isVisible: vf.isVisible,
      width: vf.width,
    })),
    ...object.fields
      .filter((f) => !stored.some((s) => s.field === f))
      .map((f) => ({ fieldName: f.name, isVisible: true, width: null })),
  ].map((f, position) => ({ ...f, position }));
  const kanbanField = object.fields.find((f) => f.id === view.kanbanFieldId);
  return {
    id: view.id,
    objectId: object.id,
    objectName: object.nameSingular,
    name: view.name,
    type: view.type === ViewType.KANBAN && kanbanField ? ViewType.KANBAN : ViewType.TABLE,
    isDefault: view.isDefault,
    kanbanFieldName: kanbanField?.name ?? null,
    filterConjunction: view.filterConjunction,
    position: view.position,
    fields,
    filters: [...view.filters]
      .sort((a, b) => a.position - b.position)
      .filter((f) => known.has(f.fieldName))
      .map((f) => ({ fieldName: f.fieldName, operator: f.operator, value: f.value ?? undefined })),
    sorts: [...view.sorts]
      .sort((a, b) => a.position - b.position)
      .filter((s) => known.has(s.fieldName))
      .map((s) => ({ fieldName: s.fieldName, direction: s.direction })),
  };
}
