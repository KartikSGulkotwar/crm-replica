import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { loadEnv } from './config/env';
import { databaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RecordsModule } from './records/records.module';
import { ViewsModule } from './views/views.module';
import { AppsModule } from './apps/apps.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { LlmModule } from './llm/llm.module';
import { AgentsModule } from './agents/agents.module';
import { RedisModule } from './redis/redis.module';
import { redisOptionsFromUrl } from './redis/redis-connection';

const env = loadEnv();

// In production the API also serves the built React app, so everything lives on one URL.
const webDist = join(__dirname, '..', '..', 'web', 'dist');
const staticModules = existsSync(webDist)
  ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })]
  : [];

@Module({
  imports: [
    databaseModule({ runMigrations: true }),
    BullModule.forRoot({
      connection: redisOptionsFromUrl(env.REDIS_URL),
      prefix: env.BULLMQ_PREFIX,
    }),
    RedisModule,
    HealthModule,
    AuthModule,
    EventEmitterModule.forRoot(),
    RecordsModule,
    ViewsModule,
    AppsModule,
    WorkflowsModule,
    LlmModule,
    AgentsModule,
    ...staticModules,
  ],
})
export class AppModule {}
