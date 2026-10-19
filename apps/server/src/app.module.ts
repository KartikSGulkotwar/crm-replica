import './database/pg-types';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { loadEnv } from './config/env';
import { MIGRATIONS } from './database/migrations';
import { HealthModule } from './health/health.module';
import { RecordsModule } from './records/records.module';
import { ViewsModule } from './views/views.module';
import { AppsModule } from './apps/apps.module';
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
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: env.DATABASE_URL,
      autoLoadEntities: true,
      // Metadata tables change only through migrations, applied when the API starts.
      synchronize: false,
      migrations: MIGRATIONS,
      migrationsRun: true,
      retryAttempts: env.NODE_ENV === 'test' ? 1 : 10,
    }),
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
    ...staticModules,
  ],
})
export class AppModule {}
