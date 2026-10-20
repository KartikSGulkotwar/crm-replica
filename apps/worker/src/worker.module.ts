import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@crm-replica/shared';
import { WorkerRootModule } from '@crm-replica/server/worker-root.module';
import { SystemProcessor } from './system.processor';

/** The worker: workflow runs (from the server's WorkerRootModule) plus the health-check ping. */
@Module({
  imports: [WorkerRootModule, BullModule.registerQueue({ name: QUEUES.SYSTEM })],
  providers: [SystemProcessor],
})
export class WorkerModule {}
