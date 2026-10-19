import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'core', name: 'api_key' })
export class ApiKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('uuid', { name: 'created_by' })
  createdBy: string;

  @Column('text')
  name: string;

  @Column('text', { name: 'key_prefix' })
  keyPrefix: string;

  @Column('text', { name: 'key_hash', select: false })
  keyHash: string;

  @Column('timestamptz', { name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
