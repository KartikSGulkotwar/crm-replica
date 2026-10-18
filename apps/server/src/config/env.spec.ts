import type { loadEnv as LoadEnv } from './env';

/** loadEnv caches its result, so each case loads a fresh copy of the module. */
function freshLoadEnv(env: Record<string, string | undefined>): ReturnType<typeof LoadEnv> {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let result!: ReturnType<typeof LoadEnv>;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      result = (require('./env') as { loadEnv: typeof LoadEnv }).loadEnv();
    });
    return result;
  } finally {
    process.env = saved;
  }
}

describe('loadEnv', () => {
  it('uses a development JWT secret outside production', () => {
    expect(freshLoadEnv({ NODE_ENV: 'test', JWT_SECRET: undefined }).JWT_SECRET).toBeTruthy();
  });

  it('refuses to start in production without a strong JWT secret', () => {
    expect(() => freshLoadEnv({ NODE_ENV: 'production', JWT_SECRET: undefined })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => freshLoadEnv({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('refuses the placeholder secret from .env.example in production', () => {
    expect(() =>
      freshLoadEnv({ NODE_ENV: 'production', JWT_SECRET: 'change-me-to-a-long-random-string' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('accepts a 32+ character secret in production', () => {
    const secret = 'x'.repeat(32);
    expect(freshLoadEnv({ NODE_ENV: 'production', JWT_SECRET: secret }).JWT_SECRET).toBe(secret);
  });
});
