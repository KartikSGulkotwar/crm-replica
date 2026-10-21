import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { AuthedRequest } from '../auth/auth.decorators';
import { loadEnv } from '../config/env';
import { REDIS } from '../redis/redis.module';

/**
 * Requests per minute for each signed-in user (or API key, or IP address when signed out),
 * counted in Redis so the limit holds across API instances. If Redis is unavailable the
 * request goes through: a missing counter shouldn't take the API down.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ApiRateLimitGuard.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const limit = loadEnv().API_RATE_LIMIT;
    const who = req.auth
      ? `${req.auth.viaApiKey ? 'key' : 'user'}:${req.auth.user.id}`
      : `ip:${req.ip ?? 'unknown'}`;
    const minute = Math.floor(Date.now() / 60_000);
    let count: number;
    try {
      const key = `${loadEnv().BULLMQ_PREFIX}:api-rate:${who}:${minute}`;
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 70);
    } catch (error) {
      this.logger.warn(`Rate limit check skipped: ${(error as Error).message}`);
      return true;
    }
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      const retryAfter = Math.max(1, Math.ceil(((minute + 1) * 60_000 - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        `Too many requests. Please wait ${retryAfter} seconds and try again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
