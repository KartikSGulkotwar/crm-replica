/** Files written by `crm init`. */
export function initFiles(name: string, url: string, inWorkspace: boolean): Record<string, string> {
  const version = inWorkspace ? 'workspace:*' : '^0.1.0';
  return {
    'crm.json': `${JSON.stringify({ name, url }, null, 2)}\n`,
    'package.json': `${JSON.stringify(
      {
        name,
        private: true,
        scripts: {
          validate: 'crm validate',
          diff: 'crm diff',
          push: 'crm push',
          pull: 'crm pull',
          typecheck: 'tsc --noEmit',
        },
        devDependencies: {
          '@crm-replica/cli': version,
          '@crm-replica/sdk': version,
          typescript: '~5.9.3',
        },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['objects', 'views'],
      },
      null,
      2,
    )}\n`,
    '.env.example':
      '# Create a key in Settings → API keys, then copy this file to .env\nCRM_API_KEY=\n',
    '.gitignore': '.env\nnode_modules\n',
    'objects/project.ts': `import { defineObject, FieldType } from '@crm-replica/sdk';

export default defineObject({
  nameSingular: 'project',
  namePlural: 'projects',
  labelSingular: 'Project',
  labelPlural: 'Projects',
  icon: 'folder',
  fields: [
    { name: 'name', label: 'Name', type: FieldType.TEXT, isRequired: true },
    { name: 'status', label: 'Status', type: FieldType.SELECT, options: ['Planned', 'Active', 'Done'], defaultValue: 'PLANNED' },
    { name: 'dueDate', label: 'Due date', type: FieldType.DATE },
  ],
});
`,
    'views/projects-board.ts': `import { defineView, ViewType } from '@crm-replica/sdk';

export default defineView({
  name: 'Projects board',
  object: 'projects',
  type: ViewType.KANBAN,
  kanbanField: 'status',
});
`,
    'README.md': `# ${name}

Objects and views for the CRM, defined as code.

\`\`\`bash
cp .env.example .env   # paste an API key from Settings → API keys
crm validate           # check the definitions
crm diff               # preview what would change in the workspace
crm push               # apply it
crm pull               # write the workspace's custom objects and views back to code
\`\`\`
`,
  };
}
