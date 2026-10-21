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
  JWT_SECRET: z.string().optional(),
  /** First retry delay for failed workflow steps (doubles each attempt). */
  WORKFLOW_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  /** Attempts per workflow run job (1 + retries). */
  WORKFLOW_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  /** Let HTTP steps call private/internal addresses (localhost, 10.x, …). Off by default. */
  WORKFLOW_HTTP_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Send workflow emails through Resend; without it, emails are only logged. */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('CRM Replica <onboarding@resend.dev>'),
  /** Enables the AI assistant and the workflow AI step. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  /** Messages to the AI assistant allowed per user per minute. */
  AGENT_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  /** Sign-up / login / accept-invite attempts allowed per IP per minute. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /** API requests per user (or API key / IP) per minute. */
  API_RATE_LIMIT: z.coerce.number().int().positive().default(600),
  /** Messages to the AI assistant per user per day (0 = no daily limit). */
  AGENT_DAILY_LIMIT: z.coerce.number().int().min(0).default(0),
  /**
   * Public demo: keeps a workspace with demo data that anyone can log into (the login is shown
   * on the login page) and rebuilds it on a schedule.
   */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEMO_EMAIL: z.string().email().default('demo@example.com'),
  DEMO_PASSWORD: z.string().min(8).default('try-the-demo'),
  /** When to rebuild the demo workspace (cron, UTC). Default: every night at 03:00. */
  DEMO_RESET_CRON: z.string().default('0 3 * * *'),
});

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';
/** The value shipped in .env.example; never acceptable in production. */
const EXAMPLE_JWT_SECRET = 'change-me-to-a-long-random-string';

export type Env = Omit<z.infer<typeof envSchema>, 'JWT_SECRET'> & { JWT_SECRET: string };

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
  const data = parsed.data;
  const secret = data.JWT_SECRET;
  if (
    data.NODE_ENV === 'production' &&
    (!secret || secret.length < 32 || secret === EXAMPLE_JWT_SECRET)
  ) {
    throw new Error(
      'JWT_SECRET must be set to a random value of at least 32 characters in production.',
    );
  }
  cached = { ...data, JWT_SECRET: data.JWT_SECRET || DEV_JWT_SECRET };
  return cached;
}
