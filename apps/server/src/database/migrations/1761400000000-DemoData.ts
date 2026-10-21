import { MigrationInterface, QueryRunner } from 'typeorm';

/** Remembers when a workspace loaded the demo data, so it's only added once. */
export class DemoData1761400000000 implements MigrationInterface {
  name = 'DemoData1761400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE core.workspace ADD COLUMN demo_data_loaded_at timestamptz`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE core.workspace DROP COLUMN demo_data_loaded_at`);
  }
}
