import { WorkspaceRole } from '@crm-replica/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkspaceEntity } from '../workspace/workspace.entity';

@Entity({ schema: 'core', name: 'user' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: WorkspaceEntity;

  /** Always stored lowercased. */
  @Column('text')
  email: string;

  @Column('text')
  name: string;

  @Column('text', { name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: WorkspaceRole, enumName: 'workspace_role' })
  role: WorkspaceRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
