import { ViewType } from '@crm-replica/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'core', name: 'view' })
export class ViewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('uuid', { name: 'object_id' })
  objectId: string;

  @Column('text')
  name: string;

  @Column('text')
  type: ViewType;

  @Column('uuid', { name: 'kanban_field_id', nullable: true })
  kanbanFieldId: string | null;

  @Column('text', { name: 'filter_conjunction' })
  filterConjunction: 'and' | 'or';

  @Column('boolean', { name: 'is_default' })
  isDefault: boolean;

  @Column('integer')
  position: number;

  @Column('uuid', { name: 'created_by', nullable: true })
  createdBy: string | null;

  @OneToMany(() => ViewFieldEntity, (f) => f.view)
  fields: ViewFieldEntity[];

  @OneToMany(() => ViewFilterEntity, (f) => f.view)
  filters: ViewFilterEntity[];

  @OneToMany(() => ViewSortEntity, (s) => s.view)
  sorts: ViewSortEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ schema: 'core', name: 'view_field' })
export class ViewFieldEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'view_id' })
  viewId: string;

  @ManyToOne(() => ViewEntity, (v) => v.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'view_id' })
  view: ViewEntity;

  @Column('uuid', { name: 'field_id' })
  fieldId: string;

  @Column('boolean', { name: 'is_visible' })
  isVisible: boolean;

  @Column('integer', { nullable: true })
  width: number | null;

  @Column('integer')
  position: number;
}

@Entity({ schema: 'core', name: 'view_filter' })
export class ViewFilterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'view_id' })
  viewId: string;

  @ManyToOne(() => ViewEntity, (v) => v.filters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'view_id' })
  view: ViewEntity;

  @Column('text', { name: 'field_name' })
  fieldName: string;

  @Column('text')
  operator: string;

  @Column('jsonb', { nullable: true })
  value: unknown;

  @Column('integer')
  position: number;
}

@Entity({ schema: 'core', name: 'view_sort' })
export class ViewSortEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'view_id' })
  viewId: string;

  @ManyToOne(() => ViewEntity, (v) => v.sorts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'view_id' })
  view: ViewEntity;

  @Column('text', { name: 'field_name' })
  fieldName: string;

  @Column('text')
  direction: 'asc' | 'desc';

  @Column('integer')
  position: number;
}
