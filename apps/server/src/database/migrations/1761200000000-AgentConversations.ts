import { MigrationInterface, QueryRunner } from 'typeorm';

/** AI assistant conversations: the API message history plus what the chat panel shows. */
export class AgentConversations1761200000000 implements MigrationInterface {
  name = 'AgentConversations1761200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.agent_conversation (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES core.workspace(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES core."user"(id) ON DELETE CASCADE,
        title text NOT NULL DEFAULT 'New conversation',
        -- Messages exactly as sent to the model (append-only).
        messages jsonb NOT NULL DEFAULT '[]',
        -- What the chat panel renders (questions, answers, proposals and their outcome).
        transcript jsonb NOT NULL DEFAULT '[]',
        -- Changes the assistant proposed that are waiting for the user's approval.
        pending jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX agent_conversation_user_idx ON core.agent_conversation (user_id, updated_at DESC)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE core.agent_conversation`);
  }
}
