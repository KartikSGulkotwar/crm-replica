import { FieldSettings, FieldType, RelationOnDelete, SelectOption } from '@crm-replica/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ObjectMetadataEntity } from './object-metadata.entity';

@Entity({ schema: 'core', name: 'field_metadata' })
export class FieldMetadataEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('uuid', { name: 'object_id' })
  objectId: string;

  @ManyToOne(() => ObjectMetadataEntity, (o) => o.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'object_id' })
  object: ObjectMetadataEntity;

  /** camelCase API name; the column is its snake_case form (see column-mapping.ts). */
  @Column('text')
  name: string;

  @Column('text')
  label: string;

  @Column('text')
  type: FieldType;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('boolean', { name: 'is_custom' })
  isCustom: boolean;

  @Column('boolean', { name: 'is_required', default: false })
  isRequired: boolean;

  @Column('jsonb', { name: 'default_value', nullable: true })
  defaultValue: unknown;

  @Column('jsonb', { nullable: true })
  options: SelectOption[] | null;

  @Column('jsonb', { nullable: true })
  settings: FieldSettings | null;

  @Column('uuid', { name: 'relation_target_object_id', nullable: true })
  relationTargetObjectId: string | null;

  @Column('text', { name: 'relation_inverse_name', nullable: true })
  relationInverseName: string | null;

  @Column('text', { name: 'relation_inverse_label', nullable: true })
  relationInverseLabel: string | null;

  @Column('text', { name: 'relation_on_delete', nullable: true })
  relationOnDelete: RelationOnDelete | null;

  @Column('integer', { default: 0 })
  position: number;

  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
