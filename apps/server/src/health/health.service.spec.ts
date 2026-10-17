import { Logger } from '@nestjs/common';
import { HealthService } from './health.service';

function makeService(opts: { db?: boolean; redis?: boolean; worker?: boolean }) {
  const dataSource = {
    query: jest.fn(() =>
      opts.db === false ? Promise.reject(new Error('db down')) : Promise.resolve([]),
    ),
  };
  const redis = {
    ping: jest.fn(() =>
      opts.redis === false ? Promise.reject(new Error('no redis')) : Promise.resolve('PONG'),
    ),
  };
  const service = new HealthService(dataSource as never, redis as never, {} as never);
  // The worker round-trip is covered by the e2e test; stub it here.
  jest
    .spyOn(service as never as { pingWorker: () => Promise<unknown> }, 'pingWorker')
    .mockImplementation(() =>
      opts.worker === false
        ? Promise.reject(new Error('no worker'))
        : Promise.resolve({ pong: true }),
    );
  return service;
}

describe('HealthService', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports ok when every dependency is up', async () => {
    const result = await makeService({}).check();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'up', redis: 'up', worker: 'up' });
  });

  it('reports degraded with the failing component marked down', async () => {
    const result = await makeService({ worker: false }).check();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ database: 'up', redis: 'up', worker: 'down' });
  });

  it('marks the database down when the query fails', async () => {
    const result = await makeService({ db: false }).check();
    expect(result.checks.database).toBe('down');
  });
});
