// Runs before each e2e test file. A unique BullMQ prefix keeps test jobs away from any
// worker started by `pnpm dev` on the same Redis.
process.env.BULLMQ_PREFIX = `test-${process.pid}-${Date.now()}`;
