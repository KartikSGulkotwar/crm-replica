import { testDatabaseUrl } from './utils/test-database';

// Runs before each e2e test file.
process.env.DATABASE_URL = testDatabaseUrl();
// A unique BullMQ prefix keeps test jobs away from any worker started by `pnpm dev`.
process.env.BULLMQ_PREFIX = `test-${process.pid}-${Date.now()}`;
// Plenty of headroom for tests. Always reset: rate-limit.e2e-spec.ts lowers it, and test files
// share one process (--runInBand), so its value would otherwise leak into later files.
process.env.AUTH_RATE_LIMIT = '1000';
// Fast retries in tests, and let HTTP steps call the local test server.
process.env.WORKFLOW_RETRY_DELAY_MS = '50';
process.env.WORKFLOW_HTTP_ALLOW_PRIVATE = 'true';
