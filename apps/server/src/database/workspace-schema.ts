const SCHEMA_NAME = /^workspace_[0-9a-f]{32}$/;

/** Each workspace's records live in their own Postgres schema: `workspace_<uuid without dashes>`. */
export function workspaceSchemaName(workspaceId: string): string {
  const name = `workspace_${workspaceId.replace(/-/g, '').toLowerCase()}`;
  return assertWorkspaceSchemaName(name);
}

/**
 * Schema names end up inside DDL (identifiers can't be bound as parameters), so we only ever
 * accept names that match our own generated format exactly.
 */
export function assertWorkspaceSchemaName(name: string): string {
  if (!SCHEMA_NAME.test(name))
    throw new Error(`Refusing unsafe schema name: ${JSON.stringify(name)}`);
  return name;
}
