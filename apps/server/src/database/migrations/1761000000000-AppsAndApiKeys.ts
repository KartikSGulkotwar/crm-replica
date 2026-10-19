import { MigrationInterface, QueryRunner } from 'typeorm';

/** API keys for the CLI / REST API, and which app (if any) manages each object, field and view. */
export class AppsAndApiKeys1761000000000 implements MigrationInterface {
  name = 'AppsAndApiKeys1761000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.api_key (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        -- The key acts as the admin who created it; removing that person revokes their keys.
        created_by uuid NOT NULL REFERENCES core."user"(id) ON DELETE CASCADE,
        name text NOT NULL,
        -- First characters, shown in Settings so keys can be told apart.
        key_prefix text NOT NULL,
        -- SHA-256 of the full key. The key itself is shown once and never stored.
        key_hash text NOT NULL UNIQUE,
        last_used_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX api_key_workspace_idx ON core.api_key (workspace_id)`);
    for (const table of ['object_metadata', 'field_metadata', 'view']) {
      await q.query(`ALTER TABLE core.${table} ADD COLUMN managed_by_app text`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of ['object_metadata', 'field_metadata', 'view']) {
      await q.query(`ALTER TABLE core.${table} DROP COLUMN managed_by_app`);
    }
    await q.query(`DROP TABLE core.api_key`);
  }
}
