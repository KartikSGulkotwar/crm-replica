import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecordContext, RecordsService } from '../records/records.service';
import { buildDemoData } from './demo-data';

export interface DemoDataResult {
  companies: number;
  people: number;
  opportunities: number;
  notes: number;
  tasks: number;
}

/**
 * Fills a workspace with the demo pipeline. Records go through the normal records service
 * (same validation, timeline entries), marked as `demo` so they don't set off workflows.
 */
@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly records: RecordsService,
  ) {}

  async loadedAt(workspaceId: string): Promise<Date | null> {
    const [row] = (await this.dataSource.query(
      `SELECT demo_data_loaded_at FROM core.workspace WHERE id = $1`,
      [workspaceId],
    )) as { demo_data_loaded_at: Date | null }[];
    return row?.demo_data_loaded_at ?? null;
  }

  async load(
    workspace: { id: string; schemaName: string },
    userId: string,
  ): Promise<DemoDataResult> {
    // Claim it first, so two clicks can't load it twice.
    const claimed = (await this.dataSource.query(
      `UPDATE core.workspace SET demo_data_loaded_at = now() WHERE id = $1 AND demo_data_loaded_at IS NULL RETURNING id`,
      [workspace.id],
    )) as unknown[];
    if (!(Array.isArray(claimed[0]) ? claimed[0].length : claimed.length)) {
      throw new ConflictException('Demo data was already added to this workspace');
    }
    try {
      return await this.insert(workspace, userId);
    } catch (error) {
      // Let them try again (records added so far stay).
      await this.dataSource.query(
        `UPDATE core.workspace SET demo_data_loaded_at = NULL WHERE id = $1`,
        [workspace.id],
      );
      throw error;
    }
  }

  private async insert(workspace: { id: string; schemaName: string }, userId: string) {
    const started = Date.now();
    const ctx: RecordContext = { workspace, userId, source: 'demo' };
    const data = buildDemoData();
    const ids = new Map<string, { object: string; id: string }>();
    const create = async (plural: string, object: string, key: string | null, values: object) => {
      const record = await this.records.create(ctx, plural, values);
      if (key) ids.set(key, { object, id: record.id });
      return record;
    };
    const ref = (key: string) => ids.get(key)!;

    for (const c of data.companies) await create('companies', 'company', c.key, c.values);
    for (const p of data.people) {
      await create('people', 'person', p.key, { ...p.values, companyId: ref(p.company).id });
    }
    for (const o of data.opportunities) {
      await create('opportunities', 'opportunity', o.key, {
        ...o.values,
        companyId: ref(o.company).id,
        pointOfContactId: ref(o.contact).id,
      });
    }
    for (const n of data.notes) {
      await create('notes', 'note', null, { ...n.values, targets: n.targets.map(ref) });
    }
    for (const t of data.tasks) {
      await create('tasks', 'task', null, {
        ...t.values,
        assigneeId: userId,
        targets: t.targets.map(ref),
      });
    }
    this.logger.log(`Demo data added to workspace ${workspace.id} in ${Date.now() - started} ms`);
    return {
      companies: data.companies.length,
      people: data.people.length,
      opportunities: data.opportunities.length,
      notes: data.notes.length,
      tasks: data.tasks.length,
    };
  }
}
