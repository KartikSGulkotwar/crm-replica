import type {
  StepRunDto,
  TriggerPayload,
  WorkflowDefinition,
  WorkflowRunStatus,
  WorkflowVersionStatus,
} from '@crm-replica/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'core', name: 'workflow' })
export class WorkflowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('text')
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  /** The published version that triggers; null when the workflow is off. */
  @Column('uuid', { name: 'active_version_id', nullable: true })
  activeVersionId: string | null;

  @Column('text', { name: 'managed_by_app', nullable: true })
  managedByApp: string | null;

  @Column('uuid', { name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ schema: 'core', name: 'workflow_version' })
export class WorkflowVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workflow_id' })
  workflowId: string;

  @Column('integer')
  version: number;

  @Column('text')
  status: WorkflowVersionStatus;

  @Column('jsonb')
  definition: WorkflowDefinition;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt: Date | null;
}

@Entity({ schema: 'core', name: 'workflow_run' })
export class WorkflowRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('uuid', { name: 'workflow_id' })
  workflowId: string;

  @Column('uuid', { name: 'version_id' })
  versionId: string;

  @Column('text')
  status: WorkflowRunStatus;

  @Column('boolean', { name: 'is_test' })
  isTest: boolean;

  @Column('integer')
  depth: number;

  @Column('jsonb')
  trigger: TriggerPayload;

  @Column('jsonb')
  steps: StepRunDto[];

  @Column('text', { nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column('timestamptz', { name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt: Date | null;
}
