import { Logger } from '@nestjs/common';
import { SYSTEM_JOBS } from '@crm-replica/shared';
import type { Job } from 'bullmq';
import { SystemProcessor } from './system.processor';

describe('SystemProcessor', () => {
  beforeAll(() => Logger.overrideLogger(false));
  const processor = new SystemProcessor();

  it('answers ping jobs', async () => {
    const result = await processor.process({ name: SYSTEM_JOBS.PING } as Job);
    expect(result).toMatchObject({ pong: true, workerPid: process.pid });
  });

  it('rejects unknown jobs so BullMQ marks them failed', async () => {
    await expect(processor.process({ name: 'nope' } as Job)).rejects.toThrow('Unknown system job');
  });
});
