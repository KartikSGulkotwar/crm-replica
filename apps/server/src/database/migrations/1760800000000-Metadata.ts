import { MigrationInterface, QueryRunner } from 'typeorm';

/** The "schema about the schema": which objects and fields each workspace has. */
export class Metadata1760800000000 implements MigrationInterface {
  name = 'Metadata1760800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.object_metadata (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        name_singular text NOT NULL,
        name_plural text NOT NULL,
        label_singular text NOT NULL,
        label_plural text NOT NULL,
        description text,
        icon text,
        table_name text NOT NULL,
        is_custom boolean NOT NULL,
        is_system boolean NOT NULL DEFAULT false,
        label_identifier_field_name text,
        position integer NOT NULL DEFAULT 0,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        -- Not partial: a soft-deleted object still owns its table, so its names stay taken.
        UNIQUE (workspace_id, name_singular),
        UNIQUE (workspace_id, name_plural),
        UNIQUE (workspace_id, table_name)
      )`);
    await q.query(`
      CREATE TABLE core.field_metadata (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        object_id uuid NOT NULL REFERENCES core.object_metadata(id) ON DELETE CASCADE,
        name text NOT NULL,
        label text NOT NULL,
        type text NOT NULL,
        description text,
        is_custom boolean NOT NULL,
        is_required boolean NOT NULL DEFAULT false,
        default_value jsonb,
        options jsonb,
        settings jsonb,
        relation_target_object_id uuid REFERENCES core.object_metadata(id) ON DELETE CASCADE,
        relation_inverse_name text,
        relation_inverse_label text,
        relation_on_delete text,
        position integer NOT NULL DEFAULT 0,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (object_id, name)
      )`);
    await q.query(
      `CREATE INDEX field_metadata_workspace_idx ON core.field_metadata (workspace_id)`,
    );
    await q.query(
      `CREATE INDEX field_metadata_relation_target_idx ON core.field_metadata (relation_target_object_id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core.field_metadata`);
    await q.query(`DROP TABLE core.object_metadata`);
  }
}
