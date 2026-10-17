import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@crm-replica/shared';
import { loadEnv } from '@crm-replica/server/config/env';
import { redisOptionsFromUrl } from '@crm-replica/server/redis/redis-connection';
import { SystemProcessor } from './system.processor';

const env = loadEnv();

@Module({
  imports: [
    BullModule.forRoot({
      connection: redisOptionsFromUrl(env.REDIS_URL),
      prefix: env.BULLMQ_PREFIX,
    }),
    BullModule.registerQueue({ name: QUEUES.SYSTEM }),
  ],
  providers: [SystemProcessor],
})
export class WorkerModule {}
