import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  createViewSchema,
  MAINTENANCE_JOBS,
  QUEUES,
  StepType,
  TriggerType,
  ViewType,
  WorkflowDefinition,
} from '@crm-replica/shared';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { SignupDto } from '../auth/dto/auth.dto';
import { loadEnv } from '../config/env';
import { ident } from '../schema-sync/sql';
import { ViewsService } from '../views/views.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { DemoDataService } from './demo-data.service';

const SCHEDULER = 'demo-reset';
/** Held while the demo workspace is rebuilt, so API instances don't do it twice at once. */
const LOCK_KEY = 'crm:demo-reset';

/** The spec's example: when a deal is won, create a kickoff task on it and email the team. */
const WON_WORKFLOW: WorkflowDefinition = {
  trigger: {
    type: TriggerType.RECORD_UPDATED,
    object: 'opportunity',
    fields: ['stage'],
    when: {
      match: 'all',
      conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }],
    },
  },
  steps: [
    {
      id: 'create_task',
      name: 'Create kickoff task',
      type: StepType.CREATE_RECORD,
      object: 'task',
      values: {
        title: 'Kick off {{trigger.record.name}}',
        status: 'TO_DO',
        targets: [{ object: 'opportunity', id: '{{trigger.record.id}}' }],
      },
    },
    {
      id: 'email_team',
      name: 'Email the team',
      type: StepType.SEND_EMAIL,
      to: 'sales-team@example.com',
      subject: 'Won: {{trigger.record.name}}',
      body: 'We won {{trigger.record.name}}. Kickoff task: {{steps.create_task.result.id}}',
    },
  ],
};

/**
 * The public demo (DEMO_MODE=true): a workspace anyone can log into with the login shown on
 * the login page. It's created on first start and rebuilt from scratch on DEMO_RESET_CRON, so
 * whatever visitors change is gone the next day.
 */
@Injectable()
export class DemoWorkspaceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoWorkspaceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auth: AuthService,
    private readonly demoData: DemoDataService,
    private readonly workflows: WorkflowsService,
    private readonly views: ViewsService,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    const env = loadEnv();
    if (!env.DEMO_MODE) {
      // Demo mode was switched off: stop the nightly rebuild (the workspace itself is kept).
      await this.queue.removeJobScheduler(SCHEDULER).catch(() => undefined);
      return;
    }
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { pattern: env.DEMO_RESET_CRON, tz: 'UTC' },
      { name: MAINTENANCE_JOBS.DEMO_RESET },
    );
    if (!(await this.workspaceId())) await this.reset();
  }

  /** The demo workspace's id, or null if it doesn't exist yet. */
  async workspaceId(): Promise<string | null> {
    const [row] = (await this.dataSource.query(
      `SELECT workspace_id FROM core."user" WHERE email = $1`,
      [loadEnv().DEMO_EMAIL.toLowerCase()],
    )) as { workspace_id: string }[];
    return row?.workspace_id ?? null;
  }

  /** Deletes the demo workspace (if any) and builds a fresh one. */
  async reset(): Promise<{ workspaceId: string }> {
    const env = loadEnv();
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const started = Date.now();
    try {
      await runner.query(`SELECT pg_advisory_lock(hashtext($1))`, [LOCK_KEY]);
      const old = await this.workspaceId();
      if (old) {
        // Everything else (users, metadata, views, workflows, history…) goes with the workspace row.
        const [ws] = (await runner.query(`SELECT schema_name FROM core.workspace WHERE id = $1`, [
          old,
        ])) as { schema_name: string }[];
        await runner.startTransaction();
        try {
          if (ws) await runner.query(`DROP SCHEMA IF EXISTS ${ident(ws.schema_name)} CASCADE`);
          await runner.query(`DELETE FROM core.workspace WHERE id = $1`, [old]);
          await runner.commitTransaction();
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        }
      }
      const { session } = await this.auth.signup({
        name: 'Demo User',
        email: env.DEMO_EMAIL.toLowerCase(),
        password: env.DEMO_PASSWORD,
        workspaceName: 'Acme Demo',
      } as SignupDto);
      const workspace = await this.dataSource
        .getRepository(WorkspaceEntity)
        .findOneByOrFail({ id: session.workspace.id });
      const userId = session.user.id;
      await this.demoData.load(workspace, userId);
      await this.views.create(
        workspace,
        userId,
        createViewSchema.parse({
          object: 'opportunities',
          name: 'Pipeline',
          type: ViewType.KANBAN,
          kanbanFieldName: 'stage',
        }),
      );
      const workflow = await this.workflows.create(workspace, userId, {
        name: 'Deal won: kickoff',
        description: 'Creates a kickoff task on the deal and emails the team when a deal is won',
        definition: WON_WORKFLOW,
      });
      await this.workflows.publish(workspace, workflow.id);
      this.logger.log(`Demo workspace rebuilt in ${Date.now() - started} ms`);
      return { workspaceId: workspace.id };
    } finally {
      await runner
        .query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY])
        .catch(() => undefined);
      await runner.release();
    }
  }
}
