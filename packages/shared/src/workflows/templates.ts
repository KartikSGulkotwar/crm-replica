import type { Condition, ConditionGroup } from './definition';

/** `{{ steps.find_company.result.id }}` */
const VARIABLE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const LONE_VARIABLE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/;

/** Reads `a.b.0.c` from a context object (array indexes allowed). Missing → undefined. */
export function getPath(context: unknown, path: string): unknown {
  let value: unknown = context;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    // Only own data properties: never walk into prototypes (`__proto__`, `constructor`…).
    if (!Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const asText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** Variable paths used in a template (`trigger.record.name`, …). */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(VARIABLE)].map((m) => m[1]);
}

/**
 * Fills in `{{variables}}`. A string that is exactly one variable keeps the value's type
 * (`'{{trigger.record.amount}}'` → `{ amount: 5, currency: 'USD' }`); mixed text becomes a
 * string. Objects and arrays are resolved recursively.
 */
export function resolveTemplates(value: unknown, context: unknown): unknown {
  if (typeof value === 'string') {
    const lone = LONE_VARIABLE.exec(value);
    if (lone) return getPath(context, lone[1]) ?? null;
    return value.replace(VARIABLE, (_, path: string) => asText(getPath(context, path)));
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, context)]),
    );
  }
  return value;
}

/** Every variable used anywhere in a value (for validation and the editor). */
export function collectVariables(value: unknown): string[] {
  if (typeof value === 'string') return templateVariables(value);
  if (Array.isArray(value)) return value.flatMap(collectVariables);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectVariables);
  return [];
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function compare(a: unknown, b: unknown): number | null {
  const na = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' ? Number(a) : NaN;
  const nb = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (typeof a === 'string' && typeof b === 'string' && ISO_DATE.test(a) && ISO_DATE.test(b)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  }
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return null;
}

/** Evaluates one condition against a context (both sides may use variables). */
export function evaluateCondition(condition: Condition, context: unknown): boolean {
  const left = resolveTemplates(condition.left, context);
  const right =
    condition.right === undefined ? undefined : resolveTemplates(condition.right, context);
  switch (condition.op) {
    case 'isEmpty':
      return isEmpty(left);
    case 'isNotEmpty':
      return !isEmpty(left);
    case 'eq':
    case 'neq': {
      const equal = asText(left) === asText(right);
      return condition.op === 'eq' ? equal : !equal;
    }
    case 'contains':
    case 'notContains': {
      const found = Array.isArray(left)
        ? left.some((item) => asText(item) === asText(right))
        : asText(left).toLowerCase().includes(asText(right).toLowerCase());
      return condition.op === 'contains' ? found : !found;
    }
    default: {
      const c = compare(left, right);
      if (c === null) return false;
      return condition.op === 'gt'
        ? c > 0
        : condition.op === 'gte'
          ? c >= 0
          : condition.op === 'lt'
            ? c < 0
            : c <= 0;
    }
  }
}

/** All conditions (or any, with `match: 'any'`). An empty group is true. */
export function evaluateConditions(group: ConditionGroup | undefined, context: unknown): boolean {
  if (!group || group.conditions.length === 0) return true;
  const results = group.conditions.map((c) => evaluateCondition(c, context));
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}
