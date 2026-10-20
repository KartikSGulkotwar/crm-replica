import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '@crm-replica/shared';
import { RecordsModule } from '../records/records.module';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { EmailService } from './engine/email.service';
import { HttpStepService } from './engine/http-step.service';
import { WorkflowEngine } from './engine/workflow-engine.service';
import { WorkflowEntity, WorkflowRunEntity, WorkflowVersionEntity } from './workflow.entities';
import { WorkflowQueueService } from './workflow-queue.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { WorkflowTriggerListener } from './workflow-trigger.listener';

/** What both the API and the worker need: entities, the queue, the trigger listener and the engine. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowEntity,
      WorkflowVersionEntity,
      WorkflowRunEntity,
      WorkspaceEntity,
    ]),
    BullModule.registerQueue({ name: QUEUES.WORKFLOWS }),
    RecordsModule,
  ],
  providers: [
    WorkflowQueueService,
    WorkflowRunsService,
    WorkflowTriggerListener,
    WorkflowEngine,
    EmailService,
    HttpStepService,
  ],
  exports: [
    TypeOrmModule,
    WorkflowQueueService,
    WorkflowRunsService,
    WorkflowEngine,
    RecordsModule,
  ],
})
export class WorkflowsCoreModule {}
