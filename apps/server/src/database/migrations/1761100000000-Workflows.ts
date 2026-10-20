import { MigrationInterface, QueryRunner } from 'typeorm';

/** Workflows, their versions (one draft + one active at a time) and run history. */
export class Workflows1761100000000 implements MigrationInterface {
  name = 'Workflows1761100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.workflow (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        active_version_id uuid,
        managed_by_app text,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, name)
      )`);
    await q.query(`
      CREATE TABLE core.workflow_version (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id uuid NOT NULL REFERENCES core.workflow(id) ON DELETE CASCADE,
        version integer NOT NULL,
        status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
        definition jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        UNIQUE (workflow_id, version)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX workflow_one_draft ON core.workflow_version (workflow_id) WHERE status = 'DRAFT'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX workflow_one_active ON core.workflow_version (workflow_id) WHERE status = 'ACTIVE'`,
    );
    await q.query(`ALTER TABLE core.workflow ADD CONSTRAINT workflow_active_version_fk
      FOREIGN KEY (active_version_id) REFERENCES core.workflow_version(id) ON DELETE SET NULL`);
    // Trigger lookups on every record change: active workflows by trigger type and object.
    await q.query(`CREATE INDEX workflow_version_trigger_idx ON core.workflow_version
      ((definition->'trigger'->>'type'), (definition->'trigger'->>'object')) WHERE status = 'ACTIVE'`);
    await q.query(`
      CREATE TABLE core.workflow_run (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        workflow_id uuid NOT NULL REFERENCES core.workflow(id) ON DELETE CASCADE,
        version_id uuid NOT NULL REFERENCES core.workflow_version(id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
        is_test boolean NOT NULL DEFAULT false,
        depth integer NOT NULL DEFAULT 0,
        trigger jsonb NOT NULL,
        steps jsonb NOT NULL DEFAULT '[]',
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      )`);
    await q.query(
      `CREATE INDEX workflow_run_workflow_idx ON core.workflow_run (workflow_id, created_at DESC)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core.workflow_run`);
    await q.query(`ALTER TABLE core.workflow DROP CONSTRAINT workflow_active_version_fk`);
    await q.query(`DROP TABLE core.workflow_version`);
    await q.query(`DROP TABLE core.workflow`);
  }
}
