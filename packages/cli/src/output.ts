import type { ApplyResult, ChangeKind } from '@crm-replica/shared';
import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];
const color = (style: Style, text: string) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? styleText(style, text) : text;

const SYMBOL: Record<ChangeKind, [string, Style]> = {
  restoreObject: ['+', 'green'],
  createObject: ['+', 'green'],
  createField: ['+', 'green'],
  restoreField: ['+', 'green'],
  createView: ['+', 'green'],
  updateObject: ['~', 'yellow'],
  updateField: ['~', 'yellow'],
  updateView: ['~', 'yellow'],
  recreateField: ['±', 'red'],
  removeField: ['-', 'red'],
  removeObject: ['-', 'red'],
  removeView: ['-', 'red'],
};

export const bold = (t: string) => color('bold', t);
export const dim = (t: string) => color('dim', t);
export const red = (t: string) => color('red', t);
export const green = (t: string) => color('green', t);
export const yellow = (t: string) => color('yellow', t);

/** Renders a plan like a migration preview. */
export function formatPlan(result: ApplyResult): string {
  const lines: string[] = [];
  if (result.changes.length === 0 && result.errors.length === 0)
    return green('No changes. The workspace already matches the app.');
  for (const c of result.changes) {
    const [symbol, style] = SYMBOL[c.kind];
    lines.push(
      `  ${color(style, symbol)} ${c.summary}${c.destructive ? ` ${red('[destructive]')}` : ''}`,
    );
    for (const d of c.details) lines.push(dim(`      ${d}`));
  }
  if (result.errors.length) {
    lines.push('', red('Problems:'));
    for (const e of result.errors) lines.push(red(`  ✗ ${e}`));
  }
  const count = (kinds: string) => result.changes.filter((c) => c.kind.startsWith(kinds)).length;
  const created = count('create') + count('restore');
  const updated = count('update');
  const removed = count('remove') + count('recreate');
  const destructive = result.changes.filter((c) => c.destructive).length;
  lines.push(
    '',
    result.changes.length === 0
      ? green('No changes. The workspace already matches the app.')
      : `${green(`${created} to create`)}, ${yellow(`${updated} to update`)}, ${red(`${removed} to remove`)}${destructive ? red(` (${destructive} destructive)`) : ''}`,
  );
  return lines.join('\n');
}
