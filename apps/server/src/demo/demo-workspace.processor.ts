import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MAINTENANCE_JOBS, QUEUES } from '@crm-replica/shared';
import { Job } from 'bullmq';
import { loadEnv } from '../config/env';
import { DemoWorkspaceService } from './demo-workspace.service';

/**
 * Runs in the API process (it needs sign-up and the data model services). With several API
 * instances, BullMQ hands each scheduled job to just one of them.
 */
@Processor(QUEUES.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly demo: DemoWorkspaceService) {
    super();
  }

  async process(job: Job) {
    if (job.name === MAINTENANCE_JOBS.DEMO_RESET && loadEnv().DEMO_MODE) {
      this.logger.log('Rebuilding the demo workspace (scheduled)');
      return this.demo.reset();
    }
    return { skipped: true };
  }
}
