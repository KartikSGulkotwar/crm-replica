import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QUEUES, TriggerType, WORKFLOW_JOBS } from '@crm-replica/shared';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { PermanentStepError, WaitSignal } from './engine/step-errors';
import { WorkflowEngine } from './engine/workflow-engine.service';
import { WorkflowEntity, WorkflowRunEntity, WorkflowVersionEntity } from './workflow.entities';
import { WorkflowQueueService } from './workflow-queue.service';
import { WorkflowRunsService } from './workflow-runs.service';

/** Runs workflows. Registered only in the worker process (and in tests). */
@Processor(QUEUES.WORKFLOWS, { concurrency: 5 })
export class WorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowProcessor.name);

  constructor(
    @InjectRepository(WorkflowRunEntity) private readonly runs: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkflowVersionEntity)
    private readonly versions: Repository<WorkflowVersionEntity>,
    @InjectRepository(WorkflowEntity) private readonly workflows: Repository<WorkflowEntity>,
    private readonly engine: WorkflowEngine,
    private readonly queue: WorkflowQueueService,
    private readonly runStarter: WorkflowRunsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === WORKFLOW_JOBS.SCHEDULE) return this.onSchedule(job.data.workflowId as string);
    if (job.name === WORKFLOW_JOBS.RUN) return this.runJob(job);
    throw new Error(`Unknown workflow job "${job.name}"`);
  }

  /** A cron trigger fired: start a run of the active version, if it's still a schedule. */
  private async onSchedule(workflowId: string) {
    const workflow = await this.workflows.findOneBy({ id: workflowId });
    const version = workflow?.activeVersionId
      ? await this.versions.findOneBy({ id: workflow.activeVersionId })
      : null;
    if (!workflow || !version || version.definition.trigger.type !== TriggerType.SCHEDULE)
      return { skipped: true };
    const run = await this.runStarter.start({
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      versionId: version.id,
      trigger: { type: TriggerType.SCHEDULE, occurredAt: new Date().toISOString() },
      depth: 0,
    });
    return { runId: run.id };
  }

  private async runJob(job: Job) {
    const run = await this.runs.findOneBy({ id: job.data.runId as string });
    if (!run || ['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(run.status)) return { skipped: true };
    const version = await this.versions.findOneByOrFail({ id: run.versionId });
    await this.runs.update(
      { id: run.id },
      { status: 'RUNNING', startedAt: run.startedAt ?? new Date(), error: null },
    );

    try {
      await this.engine.execute(run, version.definition);
      await this.runs.update(
        { id: run.id },
        { status: 'SUCCEEDED', finishedAt: new Date(), error: null },
      );
      return { status: 'SUCCEEDED' };
    } catch (error) {
      if (error instanceof WaitSignal) {
        await this.runs.update({ id: run.id }, { status: 'WAITING' });
        await this.queue.enqueueRun(run.id, error.ms);
        return { status: 'WAITING' };
      }
      const message = (error as Error).message;
      const attempts = job.opts.attempts ?? 1;
      const lastAttempt = job.attemptsMade + 1 >= attempts;
      if (error instanceof PermanentStepError || lastAttempt) {
        await this.runs.update(
          { id: run.id },
          { status: 'FAILED', finishedAt: new Date(), error: message },
        );
        this.logger.warn(`Run ${run.id} failed: ${message}`);
        return { status: 'FAILED' };
      }
      // Let BullMQ retry the job with exponential backoff; it resumes at the failed step.
      await this.runs.update(
        { id: run.id },
        { error: `${message} (retrying, attempt ${job.attemptsMade + 1} of ${attempts})` },
      );
      throw error;
    }
  }
}
