import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ComponentStatus,
  HealthResponse,
  PingJobResult,
  QUEUES,
  SYSTEM_JOBS,
} from '@crm-replica/shared';
import { Queue, QueueEvents } from 'bullmq';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private queueEvents?: QueueEvents;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUES.SYSTEM) private readonly systemQueue: Queue,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis, worker] = await Promise.all([
      this.probe('database', () => this.dataSource.query('SELECT 1')),
      this.probe('redis', () => this.redis.ping()),
      this.probe('worker', () => this.pingWorker()),
    ]);
    return {
      status: database === 'up' && redis === 'up' && worker === 'up' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis, worker },
    };
  }

  /** Round-trips a job through Redis to a live worker process and back. */
  private async pingWorker(): Promise<PingJobResult> {
    this.queueEvents ??= new QueueEvents(QUEUES.SYSTEM, {
      connection: this.systemQueue.opts.connection,
      prefix: this.systemQueue.opts.prefix,
    });
    await this.queueEvents.waitUntilReady();
    const job = await this.systemQueue.add(
      SYSTEM_JOBS.PING,
      {},
      {
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    try {
      return await job.waitUntilFinished(this.queueEvents, CHECK_TIMEOUT_MS - 200);
    } catch (error) {
      // Nobody picked it up: don't leave stale pings for a worker that starts later.
      await job.remove().catch(() => undefined);
      throw error;
    }
  }

  private async probe(name: string, fn: () => Promise<unknown>): Promise<ComponentStatus> {
    try {
      await withTimeout(fn());
      return 'up';
    } catch (error) {
      this.logger.warn(`${name} check failed: ${(error as Error).message}`);
      return 'down';
    }
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
  }
}
