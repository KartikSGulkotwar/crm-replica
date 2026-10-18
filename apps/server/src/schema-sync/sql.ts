import { assertWorkspaceSchemaName } from '../database/workspace-schema';

/** Every identifier we generate is snake_case; anything else is a bug or an attack. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Quotes a table/column/index name for use in SQL. Identifiers can't be bound as parameters,
 * so this is the single gate they pass through: names come from validated metadata (never
 * straight from a request) and must still match the strict pattern here.
 */
export function ident(name: string): string {
  if (!IDENTIFIER.test(name))
    throw new Error(`Refusing unsafe SQL identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

/** `"workspace_<id>"."companies"` */
export function qualified(schema: string, table: string): string {
  return `"${assertWorkspaceSchemaName(schema)}".${ident(table)}`;
}
