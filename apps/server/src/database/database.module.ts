import { DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadEnv } from '../config/env';
import { MIGRATIONS } from './migrations';
import './pg-types';

/**
 * Postgres connection shared by the API and the worker. Only the API runs migrations (on
 * start); the worker connects to an already-migrated database.
 */
export function databaseModule(opts: { runMigrations: boolean }): DynamicModule {
  const env = loadEnv();
  return TypeOrmModule.forRoot({
    type: 'postgres',
    url: env.DATABASE_URL,
    autoLoadEntities: true,
    // Metadata tables change only through migrations.
    synchronize: false,
    migrations: MIGRATIONS,
    migrationsRun: opts.runMigrations,
    retryAttempts: env.NODE_ENV === 'test' ? 1 : 10,
  });
}
