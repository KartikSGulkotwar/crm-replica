import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  dataSource: DataSource;
  close: () => Promise<void>;
}

/**
 * Boots the real AppModule (migrations included) against the test database. Modules are
 * required lazily so a test file can change process.env first.
 */
export async function createTestApp(
  opts: {
    withWorker?: boolean;
    /** Replace providers with test doubles, e.g. `[[LlmClient, fakeLlm]]`. */
    overrides?: [token: unknown, value: unknown][];
  } = {},
): Promise<TestApp> {
  Logger.overrideLogger(['error']);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../src/app.module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupApp } = require('../../src/setup-app');
  // The worker's workflow processor can run in the same process for end-to-end tests.
  const imports = opts.withWorker
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      [AppModule, require('../../src/workflows/workflows-worker.module').WorkflowsWorkerModule]
    : [AppModule];
  const builder = Test.createTestingModule({ imports });
  for (const [token, value] of opts.overrides ?? [])
    builder.overrideProvider(token as never).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    dataSource: app.get(DataSource),
    close: () => app.close(),
  };
}

let counter = 0;
/** A unique email per call, so tests never collide. */
export const uniqueEmail = (label = 'user') => `${label}-${Date.now()}-${++counter}@example.com`;

/** Signs up a new workspace and returns an agent that keeps the session cookie. */
export async function signupAgent(t: TestApp, overrides: Partial<Record<string, string>> = {}) {
  const agent = request.agent(t.app.getHttpServer());
  const body = {
    name: 'Ada Admin',
    email: uniqueEmail('admin'),
    password: 'password123',
    workspaceName: 'Acme',
    ...overrides,
  };
  const res = await agent.post('/api/auth/signup').send(body).expect(201);
  return { agent, body, session: res.body };
}
