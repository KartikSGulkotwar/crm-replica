import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'core', name: 'workspace' })
export class WorkspaceEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  /** Postgres schema holding this workspace's record tables. */
  @Column('text', { name: 'schema_name' })
  schemaName: string;

  /** Secret part of the invite link. Resetting it invalidates the old link. */
  @Column('text', { name: 'invite_token' })
  inviteToken: string;

  @Column('timestamptz', { name: 'demo_data_loaded_at', nullable: true })
  demoDataLoadedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
