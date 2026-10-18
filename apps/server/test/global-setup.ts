import { Client } from 'pg';
import { testDatabaseUrl } from './utils/test-database';

/** Recreates the test database once per `jest` run, so every run starts empty. */
export default async function globalSetup() {
  const testUrl = new URL(testDatabaseUrl());
  const dbName = testUrl.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(dbName)) throw new Error(`Unexpected test database name ${dbName}`);

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}
