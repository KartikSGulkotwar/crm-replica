import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PingJobResult, QUEUES, SYSTEM_JOBS } from '@crm-replica/shared';
import { Job } from 'bullmq';

/** Handles internal jobs. `ping` lets the API's health check confirm a worker is alive. */
@Processor(QUEUES.SYSTEM)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  async process(job: Job): Promise<PingJobResult> {
    switch (job.name) {
      case SYSTEM_JOBS.PING:
        return { pong: true, workerPid: process.pid, at: new Date().toISOString() };
      default:
        this.logger.warn(`Unknown system job "${job.name}"`);
        throw new Error(`Unknown system job "${job.name}"`);
    }
  }
}
