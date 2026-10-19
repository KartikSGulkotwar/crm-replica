import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FieldMetadataEntity } from './field-metadata.entity';

@Entity({ schema: 'core', name: 'object_metadata' })
export class ObjectMetadataEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('text', { name: 'name_singular' })
  nameSingular: string;

  @Column('text', { name: 'name_plural' })
  namePlural: string;

  @Column('text', { name: 'label_singular' })
  labelSingular: string;

  @Column('text', { name: 'label_plural' })
  labelPlural: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('text', { nullable: true })
  icon: string | null;

  /** Postgres table inside the workspace schema (snake_case of namePlural). */
  @Column('text', { name: 'table_name' })
  tableName: string;

  @Column('boolean', { name: 'is_custom' })
  isCustom: boolean;

  @Column('boolean', { name: 'is_system', default: false })
  isSystem: boolean;

  @Column('text', { name: 'label_identifier_field_name', nullable: true })
  labelIdentifierFieldName: string | null;

  @Column('integer', { default: 0 })
  position: number;

  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  /** Name of the app (objects-as-code) that manages this, or null if created in the UI. */
  @Column('text', { name: 'managed_by_app', nullable: true })
  managedByApp: string | null;

  @OneToMany(() => FieldMetadataEntity, (f) => f.object)
  fields: FieldMetadataEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
