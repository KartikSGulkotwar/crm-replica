import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@crm-replica/shared';
import { AuthModule } from '../auth/auth.module';
import { ViewsModule } from '../views/views.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DemoDataModule } from './demo-data.module';
import { DemoLoginController } from './demo-login.controller';
import { MaintenanceProcessor } from './demo-workspace.processor';
import { DemoWorkspaceService } from './demo-workspace.service';

/** The public demo workspace (DEMO_MODE) and its nightly rebuild. */
@Module({
  imports: [
    AuthModule,
    DemoDataModule,
    WorkflowsModule,
    ViewsModule,
    BullModule.registerQueue({ name: QUEUES.MAINTENANCE }),
  ],
  controllers: [DemoLoginController],
  providers: [DemoWorkspaceService, MaintenanceProcessor],
  exports: [DemoWorkspaceService],
})
export class DemoWorkspaceModule {}
