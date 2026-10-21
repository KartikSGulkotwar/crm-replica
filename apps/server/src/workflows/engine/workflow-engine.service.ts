import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  evaluateConditions,
  RecordDto,
  resolveTemplates,
  StepRunDto,
  StepType,
  WorkflowDefinition,
  WorkflowStep,
} from '@crm-replica/shared';
import { Repository } from 'typeorm';
import { RecordContext, RecordsService } from '../../records/records.service';
import { WorkspaceModelService } from '../../records/workspace-model.service';
import { WorkspaceEntity } from '../../workspace/workspace.entity';
import { WorkflowRunEntity } from '../workflow.entities';
import { AiStepInput, AiStepService } from './ai-step.service';
import { EmailService } from './email.service';
import { HttpStepService } from './http-step.service';
import { PermanentStepError, RetryableStepError, WaitSignal } from './step-errors';

/** Values available to `{{…}}` in steps. */
export interface RunContext {
  trigger: unknown;
  steps: Record<string, { result: unknown }>;
  run: { id: string; isTest: boolean };
  now: string;
}

const MAX_STORED_JSON = 50_000;

/** Keeps stored step input/output a sensible size. */
function storable(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  return json.length > MAX_STORED_JSON ? { truncated: true, preview: json.slice(0, 2000) } : value;
}

/**
 * Executes a run's steps in order. Progress is saved after every step, so a retried or delayed
 * run continues where it stopped: steps that already succeeded are not repeated.
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    @InjectRepository(WorkflowRunEntity) private readonly runs: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    private readonly records: RecordsService,
    private readonly models: WorkspaceModelService,
    private readonly email: EmailService,
    private readonly http: HttpStepService,
    private readonly ai: AiStepService,
  ) {}

  async execute(run: WorkflowRunEntity, definition: WorkflowDefinition): Promise<void> {
    const workspace = await this.workspaces.findOneByOrFail({ id: run.workspaceId });
    const context: RunContext = {
      trigger: run.trigger,
      steps: Object.fromEntries(
        run.steps
          .filter((s) => s.status === 'SUCCEEDED')
          .map((s) => [s.stepId, { result: s.output }]),
      ),
      run: { id: run.id, isTest: run.isTest },
      now: new Date().toISOString(),
    };
    // Changes made by the workflow are attributed to automation and count towards the loop guard.
    const recordCtx: RecordContext = {
      workspace,
      userId: null,
      depth: run.depth + 1,
      source: 'workflow',
      sourceId: run.workflowId,
    };
    await this.walk(run, definition.steps, context, recordCtx);
  }

  private async walk(
    run: WorkflowRunEntity,
    steps: WorkflowStep[],
    context: RunContext,
    recordCtx: RecordContext,
  ): Promise<void> {
    for (const step of steps) {
      const previous = run.steps.find((s) => s.stepId === step.id);

      if (previous?.status === 'SUCCEEDED') {
        if (step.type === StepType.IF_ELSE) {
          const branch = (previous.output as { branch: 'then' | 'else' }).branch;
          await this.walk(run, branch === 'then' ? step.then : step.else, context, recordCtx);
        }
        continue;
      }

      if (step.type === StepType.DELAY) {
        await this.delay(run, step, previous);
        continue;
      }

      const input =
        step.type === StepType.IF_ELSE
          ? { condition: step.condition }
          : resolveTemplates(stripMeta(step), context);
      const stepRun = await this.mark(run, step, {
        status: 'RUNNING',
        input: storable(input),
        attempts: (previous?.attempts ?? 0) + 1,
        startedAt: new Date().toISOString(),
        error: null,
      });
      let output: unknown;
      try {
        output = await this.perform(step, input as Record<string, unknown>, context, recordCtx);
      } catch (error) {
        const message = errorMessage(error);
        await this.mark(run, step, {
          ...stepRun,
          status: 'FAILED',
          error: message,
          finishedAt: new Date().toISOString(),
        });
        throw isPermanent(error)
          ? new PermanentStepError(`${step.name}: ${message}`)
          : new RetryableStepError(`${step.name}: ${message}`);
      }
      await this.mark(run, step, {
        ...stepRun,
        status: 'SUCCEEDED',
        output: storable(output),
        finishedAt: new Date().toISOString(),
      });
      context.steps[step.id] = { result: output };

      if (step.type === StepType.IF_ELSE) {
        const { branch } = output as { branch: 'then' | 'else' };
        await this.walk(run, branch === 'then' ? step.then : step.else, context, recordCtx);
      }
    }
  }

  private async delay(
    run: WorkflowRunEntity,
    step: Extract<WorkflowStep, { type: StepType.DELAY }>,
    previous: StepRunDto | undefined,
  ) {
    if (previous?.status === 'WAITING' && previous.resumeAt) {
      const remaining = Date.parse(previous.resumeAt) - Date.now();
      if (remaining > 50) throw new WaitSignal(remaining);
      await this.mark(run, step, {
        ...previous,
        status: 'SUCCEEDED',
        output: { resumedAt: new Date().toISOString() },
        finishedAt: new Date().toISOString(),
      });
      return;
    }
    const resumeAt = new Date(Date.now() + step.seconds * 1000).toISOString();
    await this.mark(run, step, {
      status: 'WAITING',
      input: { seconds: step.seconds },
      attempts: 1,
      startedAt: new Date().toISOString(),
      resumeAt,
      error: null,
    });
    throw new WaitSignal(step.seconds * 1000);
  }

  private async perform(
    step: WorkflowStep,
    input: Record<string, unknown>,
    context: RunContext,
    ctx: RecordContext,
  ): Promise<unknown> {
    switch (step.type) {
      case StepType.CREATE_RECORD:
        return this.records.create(ctx, await this.plural(ctx, step.object), input.values);
      case StepType.UPDATE_RECORD: {
        if (typeof input.recordId !== 'string' || !input.recordId)
          throw new PermanentStepError('Record id is empty');
        return this.records.update(
          ctx,
          await this.plural(ctx, step.object),
          input.recordId,
          input.values,
        );
      }
      case StepType.FIND_RECORDS: {
        const page = await this.records.list(ctx, await this.plural(ctx, step.object), {
          filter: input.filter ? JSON.stringify(input.filter) : undefined,
          sort: input.sort as string | undefined,
          limit: String(input.limit ?? 10),
        });
        return {
          records: page.data,
          count: page.data.length,
          totalCount: page.totalCount,
          first: (page.data[0] as RecordDto | undefined) ?? null,
        };
      }
      case StepType.SEND_EMAIL:
        return this.email.send({
          to: String(input.to ?? ''),
          subject: String(input.subject ?? ''),
          body: String(input.body ?? ''),
        });
      case StepType.HTTP_REQUEST:
        return this.http.request({
          method: String(input.method),
          url: String(input.url ?? ''),
          headers: (input.headers as Record<string, unknown>) ?? {},
          body: input.body,
        });
      case StepType.AI:
        return this.ai.run(input as unknown as AiStepInput, ctx);
      case StepType.IF_ELSE: {
        const matched = evaluateConditions(step.condition, context);
        return { matched, branch: matched ? 'then' : 'else' };
      }
      default:
        throw new PermanentStepError(`Unsupported step type ${(step as WorkflowStep).type}`);
    }
  }

  private async plural(ctx: RecordContext, object: string): Promise<string> {
    const model = await this.models.load(ctx.workspace);
    const found = model.objects.find((o) => o.nameSingular === object || o.namePlural === object);
    if (!found) throw new PermanentStepError(`Object "${object}" doesn’t exist`);
    return found.namePlural;
  }

  /** Updates (or adds) this step's entry in the run and saves it. */
  private async mark(
    run: WorkflowRunEntity,
    step: WorkflowStep,
    patch: Partial<StepRunDto>,
  ): Promise<StepRunDto> {
    const index = run.steps.findIndex((s) => s.stepId === step.id);
    const base: StepRunDto =
      index >= 0
        ? run.steps[index]
        : {
            stepId: step.id,
            name: step.name,
            type: step.type,
            status: 'RUNNING',
            attempts: 0,
            input: null,
            output: null,
            error: null,
            startedAt: null,
            finishedAt: null,
          };
    const next: StepRunDto = {
      ...base,
      ...patch,
      stepId: step.id,
      name: step.name,
      type: step.type,
    };
    run.steps =
      index >= 0 ? run.steps.map((s, i) => (i === index ? next : s)) : [...run.steps, next];
    // (cast: TypeORM types jsonb updates as deep-partial entities)
    await this.runs.update({ id: run.id }, { steps: run.steps as never });
    return next;
  }
}

/** Step config without id/name/type/branches (what the step actually uses). */
function stripMeta(step: WorkflowStep): Record<string, unknown> {
  const { id: _id, name: _name, type: _type, ...rest } = step as unknown as Record<string, unknown>;
  return rest;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    const message = typeof response === 'string' ? response : response.message;
    return Array.isArray(message) ? message.join('; ') : String(message ?? error.message);
  }
  return (error as Error)?.message ?? String(error);
}

/** Validation and not-found errors won't go away by retrying; database/network errors might. */
function isPermanent(error: unknown): boolean {
  if (error instanceof PermanentStepError) return true;
  if (error instanceof RetryableStepError) return false;
  if (error instanceof HttpException) return error.getStatus() < 500;
  return false;
}
