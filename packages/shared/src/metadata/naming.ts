/** API names are camelCase: start with a lowercase letter, then letters and digits. */
export const API_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
/** Keeps generated Postgres identifiers (plus suffixes like `_amount`) under the 63-byte limit. */
export const API_NAME_MAX_LENGTH = 40;

/** Columns every record table has. Fields can't use these names. */
export const SYSTEM_FIELD_NAMES = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'position',
] as const;

/** Object names that would clash with routes or internal concepts. */
export const RESERVED_OBJECT_NAMES = [
  'object',
  'objects',
  'field',
  'fields',
  'metadata',
  'view',
  'views',
  'workflow',
  'workflows',
  'workspace',
  'workspaces',
  'user',
  'users',
  'record',
  'records',
  'apiKey',
  'apiKeys',
] as const;

/** `annualRevenue` → `annual_revenue`. Used for table and column names. */
export function camelToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** `Close date` → `closeDate`; `Annual Revenue ($)` → `annualRevenue`. Suggests an API name from a label. */
export function labelToApiName(label: string): string {
  const words = label
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[0-9]/.test(name) ? `n${name}` : name;
}

/** `In progress` → `IN_PROGRESS`. Stored value for a select option. */
export function labelToOptionValue(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}
