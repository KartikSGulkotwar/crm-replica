import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().default('postgres://crm:crm@localhost:5432/crm'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Namespace for BullMQ keys in Redis; tests use a unique one to stay isolated. */
  BULLMQ_PREFIX: z.string().min(1).default('crm'),
  APP_URL: z.string().url().default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

/** Walks up from the working directory to find the repo-root `.env`, so every app shares one file. */
function findEnvFile(start = process.cwd()): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let cached: Env | undefined;

/** Loads `.env` (without overriding real environment variables) and validates it. */
export function loadEnv(): Env {
  if (cached) return cached;
  const file = findEnvFile();
  if (file && process.env.NODE_ENV !== 'test') process.loadEnvFile(file);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
