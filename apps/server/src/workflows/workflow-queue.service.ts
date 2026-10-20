import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QUEUES, TriggerType, WORKFLOW_JOBS, WorkflowTrigger } from '@crm-replica/shared';
import { Queue } from 'bullmq';
import { loadEnv } from '../config/env';

const scheduleKey = (workflowId: string) => `schedule:${workflowId}`;

/** Puts workflow work on the BullMQ queue that the worker consumes. */
@Injectable()
export class WorkflowQueueService {
  constructor(@InjectQueue(QUEUES.WORKFLOWS) private readonly queue: Queue) {}

  /** Runs (or continues) a run. Failed steps are retried by BullMQ with exponential backoff. */
  async enqueueRun(runId: string, delayMs = 0): Promise<void> {
    const env = loadEnv();
    await this.queue.add(
      WORKFLOW_JOBS.RUN,
      { runId },
      {
        delay: delayMs,
        attempts: env.WORKFLOW_ATTEMPTS,
        backoff: { type: 'exponential', delay: env.WORKFLOW_RETRY_DELAY_MS },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  /** Keeps the BullMQ job scheduler in step with a workflow's active trigger. */
  async syncSchedule(workflowId: string, trigger: WorkflowTrigger | null): Promise<void> {
    if (trigger?.type === TriggerType.SCHEDULE) {
      await this.queue.upsertJobScheduler(
        scheduleKey(workflowId),
        { pattern: trigger.cron, ...(trigger.timezone ? { tz: trigger.timezone } : {}) },
        {
          name: WORKFLOW_JOBS.SCHEDULE,
          data: { workflowId },
          opts: { removeOnComplete: 100, removeOnFail: 100 },
        },
      );
    } else {
      await this.queue.removeJobScheduler(scheduleKey(workflowId));
    }
  }
}
