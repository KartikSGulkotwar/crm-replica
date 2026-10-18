import { MigrationInterface, QueryRunner } from 'typeorm';

/** Metadata tables live in the `core` schema; each workspace's records get their own schema. */
export class CoreAuth1760700000000 implements MigrationInterface {
  name = 'CoreAuth1760700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SCHEMA IF NOT EXISTS core`);
    await q.query(`
      CREATE TABLE core.workspace (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        schema_name text NOT NULL UNIQUE,
        invite_token text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE TYPE core.workspace_role AS ENUM ('admin', 'member')`);
    await q.query(`
      CREATE TABLE core."user" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        email text NOT NULL UNIQUE CHECK (email = lower(email)),
        name text NOT NULL,
        password_hash text NOT NULL,
        role core.workspace_role NOT NULL DEFAULT 'member',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX user_workspace_id_idx ON core."user" (workspace_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core."user"`);
    await q.query(`DROP TYPE core.workspace_role`);
    await q.query(`DROP TABLE core.workspace`);
  }
}
