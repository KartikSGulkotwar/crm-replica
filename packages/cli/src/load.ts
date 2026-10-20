import { AppManifest, appManifestSchema } from '@crm-replica/shared';
import { createJiti } from 'jiti';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AppConfig } from './config';

const EXTENSIONS = /\.(ts|mts|js|mjs|cjs)$/;
export const OBJECTS_DIR = 'objects';
export const VIEWS_DIR = 'views';
export const WORKFLOWS_DIR = 'workflows';

export interface LoadedApp {
  manifest: AppManifest;
  /** Where each object / view came from, for error messages. */
  files: { objects: string[]; views: string[]; workflows: string[] };
}

export class ValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => EXTENSIONS.test(f) && !f.endsWith('.d.ts') && !/\.(test|spec)\./.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Loads every default export in `objects/` and `views/` (TypeScript works directly) and
 * validates the result with the same schema the server uses.
 */
export async function loadApp(config: AppConfig): Promise<LoadedApp> {
  const jiti = createJiti(join(config.dir, 'crm.json'), { moduleCache: false, fsCache: false });
  const problems: string[] = [];
  const load = async (files: string[]) => {
    const out: unknown[] = [];
    for (const file of files) {
      try {
        const mod = (await jiti.import(file)) as { default?: unknown };
        const value = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
        if (!value || typeof value !== 'object')
          problems.push(
            `${relative(config.dir, file)}: needs a default export (defineObject / defineView)`,
          );
        else out.push(value);
      } catch (error) {
        problems.push(`${relative(config.dir, file)}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    return out;
  };
  const objectFiles = listFiles(join(config.dir, OBJECTS_DIR));
  const viewFiles = listFiles(join(config.dir, VIEWS_DIR));
  const workflowFiles = listFiles(join(config.dir, WORKFLOWS_DIR));
  const objects = await load(objectFiles);
  const views = await load(viewFiles);
  const workflows = await load(workflowFiles);
  if (problems.length) throw new ValidationError(problems);

  const parsed = appManifestSchema.safeParse({ name: config.name, objects, views, workflows });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => {
        const [section, index, ...rest] = issue.path;
        const files =
          section === 'objects'
            ? objectFiles
            : section === 'views'
              ? viewFiles
              : section === 'workflows'
                ? workflowFiles
                : [];
        const where =
          typeof index === 'number' && files[index]
            ? relative(config.dir, files[index])
            : String(section ?? 'app');
        return `${where}${rest.length ? ` (${rest.join('.')})` : ''}: ${issue.message}`;
      }),
    );
  }
  return {
    manifest: parsed.data,
    files: { objects: objectFiles, views: viewFiles, workflows: workflowFiles },
  };
}
