import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { redisOptionsFromUrl } from './redis-connection';

export const REDIS = Symbol('REDIS');

/** A general-purpose Redis client (BullMQ manages its own connections). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () =>
        new Redis({ ...redisOptionsFromUrl(loadEnv().REDIS_URL), lazyConnect: true }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    this.redis.disconnect();
  }
}
