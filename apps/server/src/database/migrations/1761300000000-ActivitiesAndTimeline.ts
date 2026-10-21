import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notes and tasks linked to any record, and the timeline of changes shown on record pages.
 * Both point at records by object name + id (records live in per-workspace tables).
 */
export class ActivitiesAndTimeline1761300000000 implements MigrationInterface {
  name = 'ActivitiesAndTimeline1761300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.activity_target (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        -- The note or task (nameSingular + record id).
        activity_object text NOT NULL CHECK (activity_object IN ('note', 'task')),
        activity_id uuid NOT NULL,
        -- The record it's about, e.g. a company.
        target_object text NOT NULL,
        target_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, activity_id, target_object, target_id)
      )`);
    await q.query(
      `CREATE INDEX activity_target_target_idx ON core.activity_target (workspace_id, target_object, target_id)`,
    );
    await q.query(`
      CREATE TABLE core.timeline_event (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        object text NOT NULL,
        record_id uuid NOT NULL,
        -- The record's title when the event happened (for feeds that span records).
        record_title text NOT NULL,
        kind text NOT NULL,
        actor_user_id uuid REFERENCES core."user"(id) ON DELETE SET NULL,
        -- user | api | workflow | agent | demo; source_id is e.g. the workflow's id.
        source text NOT NULL,
        source_id uuid,
        changes jsonb NOT NULL DEFAULT '[]',
        -- For note / task events on the records they're linked to.
        activity jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX timeline_event_record_idx ON core.timeline_event (workspace_id, object, record_id, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX timeline_event_feed_idx ON core.timeline_event (workspace_id, created_at DESC)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core.timeline_event`);
    await q.query(`DROP TABLE core.activity_target`);
  }
}
