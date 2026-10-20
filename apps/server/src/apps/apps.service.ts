import { BadRequestException, ConflictException, HttpException, Injectable } from '@nestjs/common';
import {
  ApplyResult,
  AppPlan,
  applyRequestSchema,
  createFieldSchema,
  createObjectSchema,
  createViewSchema,
  CurrentState,
  PlanChange,
  PlannedView,
  planApp,
} from '@crm-replica/shared';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { MetadataService, WorkspaceRef } from '../metadata/metadata.service';
import { ObjectMetadataEntity } from '../metadata/object-metadata.entity';
import { WorkspaceModelService } from '../records/workspace-model.service';
import { ViewsService } from '../views/views.service';
import { WorkflowsService } from '../workflows/workflows.service';

type ApplyRequest = z.output<typeof applyRequestSchema>;
const publicChanges = (plan: AppPlan) =>
  plan.changes.map(({ payload: _payload, ...change }) => change);

/**
 * Objects-as-code: compares an app's manifest with the workspace (see planApp) and applies the
 * plan in one transaction. Either every change lands or none do.
 */
@Injectable()
export class AppsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly metadata: MetadataService,
    private readonly views: ViewsService,
    private readonly models: WorkspaceModelService,
    private readonly workflows: WorkflowsService,
  ) {}

  async apply(
    workspace: WorkspaceRef,
    userId: string,
    request: ApplyRequest,
  ): Promise<ApplyResult> {
    const { manifest, dryRun, allowDestructive } = request;
    if (dryRun) {
      const plan = planApp(manifest, await this.current(workspace, this.dataSource.manager));
      return {
        app: manifest.name,
        dryRun,
        applied: false,
        changes: publicChanges(plan),
        errors: plan.errors,
      };
    }

    return this.dataSource.transaction(async (em) => {
      // Plan again under the lock, so nothing can change between planning and applying.
      await this.metadata.lock(em, workspace.id);
      const plan = planApp(manifest, await this.current(workspace, em));
      const result: ApplyResult = {
        app: manifest.name,
        dryRun,
        applied: false,
        changes: publicChanges(plan),
        errors: plan.errors,
      };
      if (plan.errors.length)
        throw new BadRequestException({ statusCode: 400, message: plan.errors, result });
      const destructive = plan.changes.filter((c) => c.destructive);
      if (destructive.length && !allowDestructive) {
        throw new ConflictException({
          statusCode: 409,
          message: `This push would delete data (${destructive.length} change${destructive.length === 1 ? '' : 's'}). Re-run with --allow-destructive to apply it.`,
          result,
        });
      }
      for (const change of plan.changes) {
        try {
          await this.execute(em, workspace, userId, manifest.name, change);
        } catch (error) {
          const message =
            error instanceof HttpException
              ? stringifyMessage(error.getResponse())
              : (error as Error).message;
          throw new BadRequestException({
            statusCode: 400,
            message: `${change.summary}: ${message}`,
            result,
          });
        }
      }
      return { ...result, applied: true };
    });
  }

  private async current(workspace: WorkspaceRef, em: EntityManager): Promise<CurrentState> {
    return {
      objects: await this.metadata.listObjects(workspace.id, { includeDeleted: true, em }),
      views: await this.views.listAll(workspace, em),
      workflows: await this.workflows.listForPlan(workspace.id, em),
    };
  }

  private async objectId(
    em: EntityManager,
    workspaceId: string,
    nameSingular: string,
  ): Promise<string> {
    const object = await em.findOneByOrFail(ObjectMetadataEntity, { workspaceId, nameSingular });
    return object.id;
  }

  private async execute(
    em: EntityManager,
    ws: WorkspaceRef,
    userId: string,
    app: string,
    change: PlanChange,
  ) {
    const p = change.payload;
    switch (p.kind) {
      case 'restoreObject':
        await this.metadata.restoreObject(ws, p.objectId, em);
        return;
      case 'createObject':
        await this.metadata.createObject(ws, createObjectSchema.parse(p.input), {
          em,
          isCustom: true,
          managedByApp: app,
        });
        return;
      case 'updateObject':
        if (Object.keys(p.changes).length)
          await this.metadata.updateObject(ws, p.objectId, p.changes, em);
        if (p.adopt) await this.metadata.setManagedBy(em, 'object', p.objectId, app);
        return;
      case 'createField':
        await this.metadata.createField(
          ws,
          await this.objectId(em, ws.id, p.objectName),
          createFieldSchema.parse(p.input),
          { em, managedByApp: app },
        );
        return;
      case 'restoreField':
        await this.metadata.restoreField(ws, p.fieldId, em);
        return;
      case 'updateField':
        if (Object.keys(p.changes).length)
          await this.metadata.updateField(ws, p.fieldId, p.changes, em);
        if (p.adopt) await this.metadata.setManagedBy(em, 'field', p.fieldId, app);
        return;
      case 'recreateField':
        await this.metadata.softDeleteField(ws, p.fieldId, em);
        await this.metadata.destroyField(ws, p.fieldId, em);
        await this.metadata.createField(
          ws,
          await this.objectId(em, ws.id, p.objectName),
          createFieldSchema.parse(p.input),
          { em, managedByApp: app },
        );
        return;
      case 'removeField':
        await this.metadata.softDeleteField(ws, p.fieldId, em);
        await this.metadata.destroyField(ws, p.fieldId, em);
        return;
      case 'removeObject':
        await this.metadata.softDeleteObject(ws, p.objectId, em);
        await this.metadata.destroyObject(ws, p.objectId, em);
        return;
      case 'createView':
        await this.views.create(
          ws,
          userId,
          createViewSchema.parse(await this.viewInput(em, ws, p.view)),
          { em, managedByApp: app },
        );
        return;
      case 'updateView': {
        const { object: _object, ...changes } = await this.viewInput(em, ws, p.view);
        await this.views.update(ws, p.viewId, changes, {
          em,
          ...(p.adopt ? { managedByApp: app } : {}),
        });
        return;
      }
      case 'removeView':
        await this.views.remove(ws, p.viewId, em);
        return;
      case 'createWorkflow':
        await this.workflows.applyFromApp(ws, userId, p.workflow, { em, app });
        return;
      case 'updateWorkflow':
        await this.workflows.applyFromApp(ws, userId, p.workflow, {
          em,
          app,
          workflowId: p.workflowId,
          republish: p.republish,
        });
        return;
      case 'removeWorkflow':
        await this.workflows.remove(ws.id, p.workflowId, em);
        return;
    }
  }

  /** A planned view → views API input. Listed fields are shown in order; the rest are hidden. */
  private async viewInput(em: EntityManager, ws: WorkspaceRef, view: PlannedView) {
    let fields: { fieldName: string; isVisible: boolean; width: number | null }[] | undefined;
    if (view.visibleFields) {
      const model = await this.models.load(ws, em);
      const object = model.objects.find((o) => o.nameSingular === view.objectName)!;
      const listed = view.visibleFields.map((f) => f.fieldName);
      fields = [
        ...view.visibleFields.map((f) => ({
          fieldName: f.fieldName,
          isVisible: true,
          width: f.width,
        })),
        ...object.fields
          .filter((f) => !listed.includes(f.name))
          .map((f) => ({ fieldName: f.name, isVisible: false, width: null })),
      ];
    }
    return {
      object: view.objectName,
      name: view.name,
      type: view.type,
      ...(view.kanbanFieldName ? { kanbanFieldName: view.kanbanFieldName } : {}),
      filterConjunction: view.filterConjunction,
      filters: view.filters,
      sorts: view.sorts,
      ...(fields ? { fields } : {}),
    };
  }
}

function stringifyMessage(response: unknown): string {
  const message = (response as { message?: unknown })?.message ?? response;
  return Array.isArray(message) ? message.join('; ') : String(message);
}
