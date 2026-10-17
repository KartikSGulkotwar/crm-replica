import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './config/env';
import { HealthModule } from './health/health.module';
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
      // Schema changes go through migrations, never auto-sync.
      synchronize: false,
      retryAttempts: env.NODE_ENV === 'test' ? 1 : 10,
    }),
    BullModule.forRoot({
      connection: redisOptionsFromUrl(env.REDIS_URL),
      prefix: env.BULLMQ_PREFIX,
    }),
    RedisModule,
    HealthModule,
    ...staticModules,
  ],
})
export class AppModule {}
