#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CrmClient } from './client';
import { fileSlug, objectSource, viewSource } from './codegen';
import { AppConfig, CliError, DEFAULT_URL, loadConfig } from './config';
import { loadApp, OBJECTS_DIR, ValidationError, VIEWS_DIR } from './load';
import { bold, dim, formatPlan, green, red, yellow } from './output';
import { initFiles } from './templates';

interface GlobalOptions {
  dir?: string;
  url?: string;
  apiKey?: string;
}

const program = new Command()
  .name('crm')
  .description('Define CRM objects, fields and views as code, and sync them with a workspace.')
  .version('0.1.0')
  .option('-d, --dir <path>', 'app folder (default: current folder)')
  .option('--url <url>', `server URL (default: CRM_URL, crm.json, or ${DEFAULT_URL})`)
  .option('--api-key <key>', 'workspace API key (default: CRM_API_KEY or the app’s .env)');

const config = (): AppConfig => {
  const opts = program.opts<GlobalOptions>();
  return loadConfig(opts.dir, { url: opts.url, apiKey: opts.apiKey });
};

async function target(client: CrmClient, cfg: AppConfig) {
  const me = await client.whoami();
  console.log(dim(`App ${bold(cfg.name)} → workspace ${bold(me.workspace.name)} at ${cfg.url}`));
}

program
  .command('init')
  .argument('[folder]', 'where to create the app', '.')
  .option('-n, --name <name>', 'app name (default: folder name)')
  .description('Create a new app with an example object and view.')
  .action((folder: string, opts: { name?: string }) => {
    const dir = resolve(folder);
    const name =
      opts.name ??
      basename(dir)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-');
    if (existsSync(join(dir, 'crm.json')))
      throw new CliError(`${relative(process.cwd(), dir) || '.'} already has a crm.json`);
    // Inside this monorepo, depend on the local packages.
    let inWorkspace = false;
    for (let d = dir; d !== dirname(d); d = dirname(d))
      if (existsSync(join(d, 'pnpm-workspace.yaml'))) inWorkspace = true;
    const url = program.opts<GlobalOptions>().url ?? DEFAULT_URL;
    for (const [file, content] of Object.entries(initFiles(name, url, inWorkspace))) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
      console.log(`${green('created')} ${relative(process.cwd(), join(dir, file))}`);
    }
    console.log(
      `\nNext: add an API key to ${relative(process.cwd(), join(dir, '.env')) || '.env'} (see .env.example), then run ${bold('crm diff')}.`,
    );
  });

program
  .command('validate')
  .description('Check the app’s definitions (no server needed).')
  .action(async () => {
    const cfg = config();
    const { manifest } = await loadApp(cfg);
    console.log(
      green(
        `✓ ${cfg.name}: ${manifest.objects.length} object(s), ${manifest.views.length} view(s) are valid`,
      ),
    );
  });

program
  .command('diff')
  .description('Show what `crm push` would change in the workspace.')
  .option('--exit-code', 'exit with code 2 when there are changes (for CI)')
  .action(async (opts: { exitCode?: boolean }) => {
    const cfg = config();
    const { manifest } = await loadApp(cfg);
    const client = new CrmClient(cfg);
    await target(client, cfg);
    const { result } = await client.apply(manifest, { dryRun: true });
    console.log(`\n${formatPlan(result)}`);
    if (result.errors.length) process.exitCode = 1;
    else if (opts.exitCode && result.changes.length) process.exitCode = 2;
  });

program
  .command('push')
  .description('Apply the app to the workspace (asks first).')
  .option('-y, --yes', 'don’t ask for confirmation')
  .option(
    '--allow-destructive',
    'allow changes that delete data (removed objects/fields, changed field types)',
  )
  .action(async (opts: { yes?: boolean; allowDestructive?: boolean }) => {
    const cfg = config();
    const { manifest } = await loadApp(cfg);
    const client = new CrmClient(cfg);
    await target(client, cfg);
    const { result: plan } = await client.apply(manifest, { dryRun: true });
    console.log(`\n${formatPlan(plan)}`);
    if (plan.errors.length) throw new CliError('Fix the problems above; nothing was changed.');
    if (plan.changes.length === 0) return;
    if (plan.changes.some((c) => c.destructive) && !opts.allowDestructive) {
      throw new CliError(
        'Refusing to delete data. Re-run with --allow-destructive if that’s intended. Nothing was changed.',
      );
    }
    if (!opts.yes) {
      if (!process.stdin.isTTY)
        throw new CliError('Not running interactively; pass --yes to apply.');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\nApply these changes? ${dim('(y/N)')} `);
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim()))
        return console.log(yellow('Cancelled. Nothing was changed.'));
    }
    const { result, message } = await client.apply(manifest, {
      dryRun: false,
      allowDestructive: opts.allowDestructive,
    });
    if (!result.applied)
      throw new CliError(`${message ?? 'The push failed'}. Nothing was changed.`);
    console.log(green(`\n✓ Applied ${result.changes.length} change(s) to the workspace.`));
  });

program
  .command('pull')
  .description('Write the workspace’s custom objects (and fields) and saved views to code.')
  .option('-f, --force', 'overwrite existing files')
  .action(async (opts: { force?: boolean }) => {
    const cfg = config();
    const client = new CrmClient(cfg);
    await target(client, cfg);
    const { objects } = await client.export();
    const written: string[] = [];
    const skipped: string[] = [];
    const write = (file: string, content: string) => {
      const path = join(cfg.dir, file);
      if (existsSync(path) && !opts.force) return skipped.push(file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      written.push(file);
    };
    for (const object of objects) {
      if (object.isSystem || (!object.isCustom && !object.fields.some((f) => f.isCustom))) continue;
      write(join(OBJECTS_DIR, `${object.nameSingular}.ts`), objectSource(object));
      for (const view of await client.views(object.namePlural)) {
        if (!view.isDefault)
          write(
            join(VIEWS_DIR, `${fileSlug(`${object.nameSingular}-${view.name}`)}.ts`),
            viewSource(view, object.namePlural),
          );
      }
    }
    for (const f of written) console.log(`${green('wrote')}   ${f}`);
    for (const f of skipped)
      console.log(`${yellow('skipped')} ${f} ${dim('(exists; use --force to overwrite)')}`);
    if (!written.length && !skipped.length)
      console.log(
        'Nothing to pull: the workspace has no custom objects, custom fields or saved views.',
      );
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(red('✗ The app’s definitions have problems:'));
    for (const p of error.problems) console.error(red(`  • ${p}`));
  } else if (error instanceof CliError) {
    console.error(red(`✗ ${error.message}`));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
