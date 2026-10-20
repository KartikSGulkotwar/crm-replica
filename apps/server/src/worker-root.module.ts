import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { loadEnv } from './config/env';
import { databaseModule } from './database/database.module';
import { redisOptionsFromUrl } from './redis/redis-connection';
import { WorkflowsWorkerModule } from './workflows/workflows-worker.module';

const env = loadEnv();

/**
 * Everything the worker process runs, built from the server's own modules (one copy of the
 * code for both processes). The worker app imports this.
 */
@Module({
  imports: [
    databaseModule({ runMigrations: false }),
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: redisOptionsFromUrl(env.REDIS_URL),
      prefix: env.BULLMQ_PREFIX,
    }),
    WorkflowsWorkerModule,
  ],
})
export class WorkerRootModule {}
