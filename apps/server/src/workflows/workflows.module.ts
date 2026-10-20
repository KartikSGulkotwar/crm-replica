import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsCoreModule } from './workflows-core.module';
import { WorkflowsService } from './workflows.service';

/** API side: endpoints for editing, publishing and running workflows. */
@Module({
  imports: [WorkflowsCoreModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
