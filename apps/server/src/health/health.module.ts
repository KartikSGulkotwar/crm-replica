import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@crm-replica/shared';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.SYSTEM })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
