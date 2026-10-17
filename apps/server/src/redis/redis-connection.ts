import type { RedisOptions } from 'ioredis';

/** Turns a `redis://` or `rediss://` URL into ioredis options that BullMQ accepts. */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isInteger(db) ? db : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ for blocking connections.
    maxRetriesPerRequest: null,
  };
}
