import { assertWorkspaceSchemaName, workspaceSchemaName } from './workspace-schema';

describe('workspace schema names', () => {
  it('derives the schema name from the workspace id', () => {
    expect(workspaceSchemaName('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(
      'workspace_3f2504e04f8911d39a0c0305e82c3301',
    );
  });

  it.each([
    'public',
    'workspace_',
    'workspace_3f2504e04f8911d39a0c0305e82c330', // too short
    'workspace_3f2504e04f8911d39a0c0305e82c3301"; DROP SCHEMA core; --',
    'WORKSPACE_3F2504E04F8911D39A0C0305E82C3301',
  ])('rejects %s', (name) => {
    expect(() => assertWorkspaceSchemaName(name)).toThrow('unsafe schema name');
  });

  it('rejects ids that would not produce a valid name', () => {
    expect(() => workspaceSchemaName('not-a-uuid')).toThrow();
  });
});
