import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CurrentWorkflow,
  PlannedWorkflow,
  RecordDto,
  SaveDraftResponse,
  TriggerPayload,
  TriggerType,
  WorkflowDefinition,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowVersionDto,
} from '@crm-replica/shared';
import { DataSource, EntityManager, In, LessThan, QueryFailedError, Repository } from 'typeorm';
import { RecordsService } from '../records/records.service';
import { WorkspaceModelService } from '../records/workspace-model.service';
import { WorkflowEntity, WorkflowRunEntity, WorkflowVersionEntity } from './workflow.entities';
import { WorkflowQueueService } from './workflow-queue.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { nextCronRun, validateWorkflow } from './workflow-validator';

interface WorkspaceRef {
  id: string;
  schemaName: string;
}

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const DEFAULT_DEFINITION: WorkflowDefinition = { trigger: { type: TriggerType.MANUAL }, steps: [] };

/**
 * Workflows and their versions. Editing changes a DRAFT; publishing makes it the ACTIVE version
 * (the previous one is ARCHIVED). Runs always point at the version they ran.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowEntity) private readonly workflows: Repository<WorkflowEntity>,
    @InjectRepository(WorkflowVersionEntity)
    private readonly versions: Repository<WorkflowVersionEntity>,
    @InjectRepository(WorkflowRunEntity) private readonly runs: Repository<WorkflowRunEntity>,
    private readonly models: WorkspaceModelService,
    private readonly records: RecordsService,
    private readonly queue: WorkflowQueueService,
    private readonly runStarter: WorkflowRunsService,
  ) {}

  // ------------------------------------------------------------- workflows

  async list(workspaceId: string): Promise<WorkflowDto[]> {
    const workflows = await this.workflows.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
    return this.toDtos(workflows);
  }

  async get(workspaceId: string, id: string): Promise<WorkflowDto> {
    return (await this.toDtos([await this.find(workspaceId, id)]))[0];
  }

  async create(
    workspace: WorkspaceRef,
    userId: string | null,
    input: { name: string; description?: string | null; definition?: WorkflowDefinition },
    opts: { em?: EntityManager; managedByApp?: string | null } = {},
  ): Promise<WorkflowDto> {
    const run = async (em: EntityManager) => {
      const workflow = await this.saveUnique(
        em,
        em.create(WorkflowEntity, {
          workspaceId: workspace.id,
          name: input.name,
          description: input.description ?? null,
          createdBy: userId,
          managedByApp: opts.managedByApp ?? null,
        }),
      );
      await em.save(
        em.create(WorkflowVersionEntity, {
          workflowId: workflow.id,
          version: 1,
          status: 'DRAFT',
          definition: input.definition ?? DEFAULT_DEFINITION,
        }),
      );
      return workflow.id;
    };
    const id = opts.em ? await run(opts.em) : await this.dataSource.transaction(run);
    return opts.em
      ? (await this.toDtos([await opts.em.findOneByOrFail(WorkflowEntity, { id })], opts.em))[0]
      : this.get(workspace.id, id);
  }

  async update(
    workspaceId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<WorkflowDto> {
    const workflow = await this.find(workspaceId, id);
    if (input.name !== undefined) workflow.name = input.name;
    if (input.description !== undefined) workflow.description = input.description ?? null;
    await this.saveUnique(this.dataSource.manager, workflow);
    return this.get(workspaceId, id);
  }

  async remove(
    workspaceId: string,
    id: string,
    em: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const workflow = await this.find(workspaceId, id, em);
    await em.delete(WorkflowEntity, { id: workflow.id });
    await this.queue.syncSchedule(workflow.id, null);
  }

  // -------------------------------------------------------------- versions

  /** Saves the draft (creating one from the active version if needed) and reports publish problems. */
  async saveDraft(
    workspace: WorkspaceRef,
    id: string,
    definition: WorkflowDefinition,
  ): Promise<SaveDraftResponse> {
    const workflow = await this.find(workspace.id, id);
    await this.dataSource.transaction(async (em) => {
      const draft = await em.findOneBy(WorkflowVersionEntity, {
        workflowId: workflow.id,
        status: 'DRAFT',
      });
      if (draft) {
        draft.definition = definition;
        await em.save(draft);
      } else {
        const latest = await em.findOne(WorkflowVersionEntity, {
          where: { workflowId: workflow.id },
          order: { version: 'DESC' },
        });
        await em.save(
          em.create(WorkflowVersionEntity, {
            workflowId: workflow.id,
            version: (latest?.version ?? 0) + 1,
            status: 'DRAFT',
            definition,
          }),
        );
      }
      await em.update(WorkflowEntity, { id: workflow.id }, { updatedAt: new Date() });
    });
    const model = await this.models.load(workspace);
    return {
      workflow: await this.get(workspace.id, id),
      problems: validateWorkflow(definition, model),
    };
  }

  async discardDraft(workspaceId: string, id: string): Promise<WorkflowDto> {
    const workflow = await this.find(workspaceId, id);
    if (!workflow.activeVersionId)
      throw new BadRequestException(
        'This workflow has never been published; there’s nothing to go back to',
      );
    await this.versions.delete({ workflowId: workflow.id, status: 'DRAFT' });
    return this.get(workspaceId, id);
  }

  /** The draft becomes the active version; it's checked against the data model first. */
  async publish(workspace: WorkspaceRef, id: string, em?: EntityManager): Promise<WorkflowDto> {
    const work = async (m: EntityManager) => {
      const workflow = await this.find(workspace.id, id, m);
      const draft = await m.findOneBy(WorkflowVersionEntity, {
        workflowId: workflow.id,
        status: 'DRAFT',
      });
      if (!draft) throw new BadRequestException('There’s no draft to publish');
      const problems = validateWorkflow(draft.definition, await this.models.load(workspace, m));
      if (problems.length) throw new BadRequestException({ statusCode: 400, message: problems });
      await m.update(
        WorkflowVersionEntity,
        { workflowId: workflow.id, status: 'ACTIVE' },
        { status: 'ARCHIVED' },
      );
      await m.update(
        WorkflowVersionEntity,
        { id: draft.id },
        { status: 'ACTIVE', publishedAt: new Date() },
      );
      await m.update(
        WorkflowEntity,
        { id: workflow.id },
        { activeVersionId: draft.id, updatedAt: new Date() },
      );
      return draft.definition;
    };
    const definition = em ? await work(em) : await this.dataSource.transaction(work);
    await this.queue.syncSchedule(id, definition.trigger);
    return em
      ? (await this.toDtos([await this.find(workspace.id, id, em)], em))[0]
      : this.get(workspace.id, id);
  }

  /** Turns the workflow off (the active version is archived; the draft is kept). */
  async deactivate(workspaceId: string, id: string): Promise<WorkflowDto> {
    const workflow = await this.find(workspaceId, id);
    await this.dataSource.transaction(async (em) => {
      await em.update(
        WorkflowVersionEntity,
        { workflowId: workflow.id, status: 'ACTIVE' },
        { status: 'ARCHIVED' },
      );
      await em.update(WorkflowEntity, { id: workflow.id }, { activeVersionId: null });
    });
    await this.queue.syncSchedule(workflow.id, null);
    return this.get(workspaceId, id);
  }

  // ------------------------------------------------------- objects as code

  /** Workflows with their active definitions, for planning an app push. */
  async listForPlan(workspaceId: string, em: EntityManager): Promise<CurrentWorkflow[]> {
    const workflows = await em.find(WorkflowEntity, { where: { workspaceId } });
    const active = workflows.length
      ? await em.find(WorkflowVersionEntity, {
          where: { workflowId: In(workflows.map((w) => w.id)), status: 'ACTIVE' },
        })
      : [];
    return workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      managedByApp: w.managedByApp,
      definition: active.find((v) => v.workflowId === w.id)?.definition ?? null,
    }));
  }

  /** Used by app pushes: writes the definition as the draft and publishes it, inside `em`. */
  async applyFromApp(
    workspace: WorkspaceRef,
    userId: string,
    planned: PlannedWorkflow,
    opts: { em: EntityManager; app: string; workflowId?: string; republish?: boolean },
  ): Promise<void> {
    const { em, app } = opts;
    let id = opts.workflowId;
    if (!id) {
      id = (
        await this.create(
          workspace,
          userId,
          { name: planned.name, description: planned.description, definition: planned.definition },
          { em, managedByApp: app },
        )
      ).id;
    } else {
      await em.update(
        WorkflowEntity,
        { id },
        { description: planned.description, managedByApp: app, updatedAt: new Date() },
      );
      if (!opts.republish) return;
      await em.delete(WorkflowVersionEntity, { workflowId: id, status: 'DRAFT' });
      const latest = await em.findOne(WorkflowVersionEntity, {
        where: { workflowId: id },
        order: { version: 'DESC' },
      });
      await em.save(
        em.create(WorkflowVersionEntity, {
          workflowId: id,
          version: (latest?.version ?? 0) + 1,
          status: 'DRAFT',
          definition: planned.definition,
        }),
      );
    }
    await this.publish(workspace, id, em);
  }

  // ------------------------------------------------------------------ runs

  /** "Run" button: starts the active version of a manual workflow, optionally on a record. */
  async runManually(
    workspace: WorkspaceRef,
    userId: string,
    id: string,
    recordId?: string,
  ): Promise<WorkflowRunDto> {
    const workflow = await this.find(workspace.id, id);
    const version = workflow.activeVersionId
      ? await this.versions.findOneBy({ id: workflow.activeVersionId })
      : null;
    if (!version) throw new BadRequestException('This workflow isn’t active. Publish it first.');
    if (version.definition.trigger.type !== TriggerType.MANUAL)
      throw new BadRequestException('Only workflows with a manual trigger can be run by hand');
    const trigger = await this.payload(workspace, userId, version.definition, recordId, false);
    const run = await this.runStarter.start({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      versionId: version.id,
      trigger,
      depth: 0,
    });
    return this.getRun(workspace.id, run.id);
  }

  /**
   * "Test run": runs the draft (or active) version once, with a record you pick (or the newest one).
   * It performs real actions; runs are marked as tests in the history.
   */
  async testRun(
    workspace: WorkspaceRef,
    userId: string,
    id: string,
    recordId?: string,
  ): Promise<WorkflowRunDto> {
    const workflow = await this.find(workspace.id, id);
    const version =
      (await this.versions.findOneBy({ workflowId: workflow.id, status: 'DRAFT' })) ??
      (workflow.activeVersionId
        ? await this.versions.findOneBy({ id: workflow.activeVersionId })
        : null);
    if (!version) throw new BadRequestException('Nothing to test');
    const problems = validateWorkflow(version.definition, await this.models.load(workspace));
    if (problems.length) throw new BadRequestException({ statusCode: 400, message: problems });
    const trigger = await this.payload(workspace, userId, version.definition, recordId, true);
    const run = await this.runStarter.start({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      versionId: version.id,
      trigger,
      depth: 0,
      isTest: true,
    });
    return this.getRun(workspace.id, run.id);
  }

  async listRuns(
    workspaceId: string,
    workflowId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<WorkflowRunDto[]> {
    const workflow = await this.find(workspaceId, workflowId);
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
    const before =
      opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : undefined;
    const runs = await this.runs.find({
      where: { workflowId: workflow.id, ...(before ? { createdAt: LessThan(before) } : {}) },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return this.toRunDtos(runs, [workflow]);
  }

  async getRun(workspaceId: string, runId: string): Promise<WorkflowRunDto> {
    if (!isUuid(runId)) throw new NotFoundException('Run not found');
    const run = await this.runs.findOneBy({ id: runId, workspaceId });
    if (!run) throw new NotFoundException('Run not found');
    const workflow = await this.workflows.findOneByOrFail({ id: run.workflowId });
    return (await this.toRunDtos([run], [workflow]))[0];
  }

  // ------------------------------------------------------------- internals

  /** What `{{trigger.…}}` holds for a manual or test run. */
  private async payload(
    workspace: WorkspaceRef,
    userId: string,
    definition: WorkflowDefinition,
    recordId: string | undefined,
    isTest: boolean,
  ): Promise<TriggerPayload> {
    const trigger = definition.trigger;
    const object = 'object' in trigger ? trigger.object : undefined;
    const occurredAt = new Date().toISOString();
    if (!object) {
      if (recordId) throw new BadRequestException('This workflow doesn’t take a record');
      return { type: trigger.type, occurredAt, actorUserId: userId };
    }
    const model = await this.models.load(workspace);
    const target = model.objects.find((o) => o.nameSingular === object);
    if (!target) throw new BadRequestException(`Object "${object}" doesn’t exist`);
    const ctx = { workspace, userId };
    let record: RecordDto | undefined;
    if (recordId) record = await this.records.get(ctx, target.namePlural, recordId);
    else if (isTest)
      record = (
        await this.records.list(ctx, target.namePlural, { sort: 'createdAt:desc', limit: '1' })
      ).data[0];
    if (!record) {
      throw new BadRequestException(
        isTest
          ? `Create a ${target.labelSingular.toLowerCase()} first, or pick one to test with`
          : 'Choose a record to run this workflow on',
      );
    }
    return {
      type: trigger.type,
      object,
      record,
      before: record,
      changedFields: trigger.type === TriggerType.RECORD_UPDATED ? (trigger.fields ?? []) : [],
      actorUserId: userId,
      occurredAt,
    };
  }

  private async find(
    workspaceId: string,
    id: string,
    em: EntityManager = this.dataSource.manager,
  ): Promise<WorkflowEntity> {
    const workflow = isUuid(id) ? await em.findOneBy(WorkflowEntity, { id, workspaceId }) : null;
    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }

  private async saveUnique(em: EntityManager, workflow: WorkflowEntity): Promise<WorkflowEntity> {
    try {
      return await em.save(workflow);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(`A workflow named "${workflow.name}" already exists`);
      }
      throw error;
    }
  }

  private async toDtos(
    workflows: WorkflowEntity[],
    em: EntityManager = this.dataSource.manager,
  ): Promise<WorkflowDto[]> {
    if (!workflows.length) return [];
    const ids = workflows.map((w) => w.id);
    const versions = await em.find(WorkflowVersionEntity, {
      where: { workflowId: In(ids), status: In(['ACTIVE', 'DRAFT']) },
    });
    const lastRuns = (await em.query(
      `SELECT DISTINCT ON (workflow_id) workflow_id, id, status, created_at FROM core.workflow_run
       WHERE workflow_id = ANY($1::uuid[]) ORDER BY workflow_id, created_at DESC`,
      [ids],
    )) as { workflow_id: string; id: string; status: WorkflowRunDto['status']; created_at: Date }[];
    return workflows.map((w) => {
      const active = versions.find((v) => v.workflowId === w.id && v.status === 'ACTIVE');
      const draft = versions.find((v) => v.workflowId === w.id && v.status === 'DRAFT');
      const last = lastRuns.find((r) => r.workflow_id === w.id);
      const trigger = active?.definition.trigger;
      return {
        id: w.id,
        name: w.name,
        description: w.description,
        isActive: Boolean(w.activeVersionId),
        managedByApp: w.managedByApp,
        activeVersion: active ? versionDto(active) : null,
        draftVersion: draft ? versionDto(draft) : null,
        lastRun: last
          ? { id: last.id, status: last.status, createdAt: new Date(last.created_at).toISOString() }
          : null,
        nextRunAt:
          trigger?.type === TriggerType.SCHEDULE
            ? (nextCronRun(trigger.cron, trigger.timezone)?.toISOString() ?? null)
            : null,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      };
    });
  }

  private async toRunDtos(
    runs: WorkflowRunEntity[],
    workflows: WorkflowEntity[],
  ): Promise<WorkflowRunDto[]> {
    if (!runs.length) return [];
    const versions = await this.versions.findBy({
      id: In([...new Set(runs.map((r) => r.versionId))]),
    });
    return runs.map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      workflowName: workflows.find((w) => w.id === r.workflowId)?.name ?? '',
      versionId: r.versionId,
      version: versions.find((v) => v.id === r.versionId)?.version ?? 0,
      status: r.status,
      isTest: r.isTest,
      depth: r.depth,
      trigger: r.trigger,
      steps: r.steps,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    }));
  }
}

function versionDto(v: WorkflowVersionEntity): WorkflowVersionDto {
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    definition: v.definition,
    createdAt: v.createdAt.toISOString(),
    publishedAt: v.publishedAt?.toISOString() ?? null,
  };
}
