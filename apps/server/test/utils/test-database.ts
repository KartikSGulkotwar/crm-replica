/** The e2e tests use `<your database>_test`, so they never touch development data. */
export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm');
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}
