import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TriggerPayload, WorkflowRunStatus } from '@crm-replica/shared';
import { Repository } from 'typeorm';
import { WorkflowRunEntity } from './workflow.entities';
import { WorkflowQueueService } from './workflow-queue.service';

export interface NewRun {
  workspaceId: string;
  workflowId: string;
  versionId: string;
  trigger: TriggerPayload;
  depth: number;
  isTest?: boolean;
}

/** Creates run records and hands them to the queue. */
@Injectable()
export class WorkflowRunsService {
  constructor(
    @InjectRepository(WorkflowRunEntity) private readonly runs: Repository<WorkflowRunEntity>,
    private readonly queue: WorkflowQueueService,
  ) {}

  async start(run: NewRun): Promise<WorkflowRunEntity> {
    const saved = await this.save(run, 'QUEUED', null);
    await this.queue.enqueueRun(saved.id);
    return saved;
  }

  /** A run that was deliberately not started (e.g. the loop guard), kept for visibility. */
  async skip(run: NewRun, reason: string): Promise<WorkflowRunEntity> {
    return this.save(run, 'SKIPPED', reason);
  }

  private save(run: NewRun, status: WorkflowRunStatus, error: string | null) {
    return this.runs.save(
      this.runs.create({
        workspaceId: run.workspaceId,
        workflowId: run.workflowId,
        versionId: run.versionId,
        trigger: run.trigger,
        depth: run.depth,
        isTest: run.isTest ?? false,
        status,
        steps: [],
        error,
        finishedAt: status === 'SKIPPED' ? new Date() : null,
      }),
    );
  }
}
