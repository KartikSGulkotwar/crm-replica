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
    // Look up both IPv4 and IPv6 addresses: Railway's private network (redis.railway.internal)
    // is IPv6-only, and ioredis only tries IPv4 by default.
    family: 0,
    // Required by BullMQ for blocking connections.
    maxRetriesPerRequest: null,
  };
}
