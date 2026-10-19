import { MigrationInterface, QueryRunner } from 'typeorm';

/** Saved ways to look at an object: table or kanban, visible fields, filters and sorts. */
export class Views1760900000000 implements MigrationInterface {
  name = 'Views1760900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.view (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        object_id uuid NOT NULL REFERENCES core.object_metadata(id) ON DELETE CASCADE,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'TABLE' CHECK (type IN ('TABLE', 'KANBAN')),
        kanban_field_id uuid REFERENCES core.field_metadata(id) ON DELETE SET NULL,
        filter_conjunction text NOT NULL DEFAULT 'and' CHECK (filter_conjunction IN ('and', 'or')),
        is_default boolean NOT NULL DEFAULT false,
        position integer NOT NULL DEFAULT 0,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX view_object_idx ON core.view (object_id)`);
    // Exactly one default view per object (also makes lazy creation race-safe).
    await q.query(
      `CREATE UNIQUE INDEX view_one_default_per_object ON core.view (object_id) WHERE is_default`,
    );
    await q.query(`
      CREATE TABLE core.view_field (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        view_id uuid NOT NULL REFERENCES core.view(id) ON DELETE CASCADE,
        field_id uuid NOT NULL REFERENCES core.field_metadata(id) ON DELETE CASCADE,
        is_visible boolean NOT NULL DEFAULT true,
        width integer,
        position integer NOT NULL DEFAULT 0,
        UNIQUE (view_id, field_id)
      )`);
    // Filters and sorts may use built-in fields (createdAt…), so they reference fields by name.
    await q.query(`
      CREATE TABLE core.view_filter (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        view_id uuid NOT NULL REFERENCES core.view(id) ON DELETE CASCADE,
        field_name text NOT NULL,
        operator text NOT NULL,
        value jsonb,
        position integer NOT NULL DEFAULT 0
      )`);
    await q.query(`
      CREATE TABLE core.view_sort (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        view_id uuid NOT NULL REFERENCES core.view(id) ON DELETE CASCADE,
        field_name text NOT NULL,
        direction text NOT NULL CHECK (direction IN ('asc', 'desc')),
        position integer NOT NULL DEFAULT 0
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core.view_sort`);
    await q.query(`DROP TABLE core.view_filter`);
    await q.query(`DROP TABLE core.view_field`);
    await q.query(`DROP TABLE core.view`);
  }
}
