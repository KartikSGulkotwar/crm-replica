import { randomUUID } from 'node:crypto';
import { workspaceSchemaName } from '../src/database/workspace-schema';
import { createTestApp, TestApp, uniqueEmail } from './utils/test-app';

describe('Standard objects backfill on startup (e2e)', () => {
  let first: TestApp | undefined;
  let second: TestApp | undefined;

  afterAll(async () => {
    await first?.close();
    await second?.close();
  });

  it('adds standard objects and member records to workspaces created before Phase 3', async () => {
    first = await createTestApp();
    const id = randomUUID();
    const schema = workspaceSchemaName(id);
    const userId = randomUUID();
    // A workspace as Phase 2 left it: a schema with no tables, and a user.
    await first.dataSource.query(
      `INSERT INTO core.workspace (id, name, schema_name, invite_token) VALUES ($1, 'Old Co', $2, $3)`,
      [id, schema, randomUUID().replace(/-/g, '')],
    );
    await first.dataSource.query(`CREATE SCHEMA "${schema}"`);
    await first.dataSource.query(
      `INSERT INTO core."user" (id, workspace_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'Old Admin', 'x', 'admin')`,
      [userId, id, uniqueEmail('old')],
    );
    await first.close();
    first = undefined;

    second = await createTestApp(); // onApplicationBootstrap runs the backfill
    const objects = await second.dataSource.query(
      `SELECT name_singular FROM core.object_metadata WHERE workspace_id = $1 ORDER BY position`,
      [id],
    );
    expect(objects.map((o: { name_singular: string }) => o.name_singular)).toEqual([
      'company',
      'person',
      'opportunity',
      'note',
      'task',
      'workspaceMember',
    ]);
    const members = await second.dataSource.query(
      `SELECT id, name FROM "${schema}"."workspace_members"`,
    );
    expect(members).toEqual([{ id: userId, name: 'Old Admin' }]);
  });
});
