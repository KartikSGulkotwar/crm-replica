import { Module } from '@nestjs/common';
import { WorkflowProcessor } from './workflow.processor';
import { WorkflowsCoreModule } from './workflows-core.module';

/** Worker side: consumes the workflows queue. */
@Module({
  imports: [WorkflowsCoreModule],
  providers: [WorkflowProcessor],
})
export class WorkflowsWorkerModule {}
