import { appNameSchema } from '@crm-replica/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CONFIG_FILE = 'crm.json';
export const DEFAULT_URL = 'http://localhost:3000';

export interface AppConfig {
  dir: string;
  name: string;
  url: string;
  apiKey?: string;
}

export class CliError extends Error {}

/**
 * Reads `crm.json` from the app folder. The server URL and API key come from (first wins):
 * flags, environment (CRM_URL, CRM_API_KEY), the app's `.env`, then `crm.json`.
 */
export function loadConfig(
  dirOption: string | undefined,
  flags: { url?: string; apiKey?: string } = {},
): AppConfig {
  const dir = resolve(dirOption ?? process.cwd());
  const file = join(dir, CONFIG_FILE);
  if (!existsSync(file))
    throw new CliError(
      `No ${CONFIG_FILE} in ${dir}. Run "crm init" to create an app, or use --dir.`,
    );
  let raw: { name?: unknown; url?: unknown };
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CliError(`${CONFIG_FILE} isn’t valid JSON`);
  }
  const name = appNameSchema.safeParse(raw.name);
  if (!name.success) throw new CliError(`${CONFIG_FILE}: "name" ${name.error.issues[0].message}`);
  const envFile = join(dir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = (
    flags.url ??
    process.env.CRM_URL ??
    (typeof raw.url === 'string' ? raw.url : undefined) ??
    DEFAULT_URL
  ).replace(/\/+$/, '');
  return { dir, name: name.data, url, apiKey: flags.apiKey ?? process.env.CRM_API_KEY };
}
