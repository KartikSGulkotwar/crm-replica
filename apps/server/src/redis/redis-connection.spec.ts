import { redisOptionsFromUrl } from './redis-connection';

describe('redisOptionsFromUrl', () => {
  it('parses a plain local URL', () => {
    expect(redisOptionsFromUrl('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379,
      tls: undefined,
      maxRetriesPerRequest: null,
    });
  });

  it('parses credentials, db index and TLS (as used by Railway)', () => {
    expect(redisOptionsFromUrl('rediss://default:p%40ss@redis.example.com:7000/2')).toMatchObject({
      host: 'redis.example.com',
      port: 7000,
      username: 'default',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });
});
