import { Injectable } from '@nestjs/common';
import { FieldType, RelationOnDelete } from '@crm-replica/shared';
import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { columnsForField } from './column-mapping';
import { ident, qualified } from './sql';

const ON_DELETE_SQL: Record<RelationOnDelete, string> = {
  SET_NULL: 'SET NULL',
  CASCADE: 'CASCADE',
  RESTRICT: 'RESTRICT',
};

/** Short, deterministic, identifier-safe name for an index or constraint. */
function constraintName(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha1').update(parts.join('.')).digest('hex').slice(0, 20)}`;
}

export interface RelationTarget {
  table: string;
  onDelete: RelationOnDelete;
}

/**
 * Turns metadata changes into DDL on a workspace's record tables. Every method runs on the
 * caller's EntityManager, so DDL commits or rolls back together with the metadata change.
 */
@Injectable()
export class SchemaSyncService {
  /** A new object → a new table with the system columns every record has. */
  async createTable(em: EntityManager, schema: string, table: string): Promise<void> {
    const t = qualified(schema, table);
    await em.query(`
      CREATE TABLE ${t} (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "created_by" uuid,
        "position" double precision NOT NULL DEFAULT 0
      )`);
    // Most queries list live records in position order.
    await em.query(
      `CREATE INDEX ${ident(constraintName('idx', schema, table, 'position'))} ON ${t} ("position") WHERE "deleted_at" IS NULL`,
    );
  }

  async dropTable(em: EntityManager, schema: string, table: string): Promise<void> {
    await em.query(`DROP TABLE IF EXISTS ${qualified(schema, table)}`);
  }

  /** A new field → `ALTER TABLE ... ADD COLUMN` (plus a foreign key and index for relations). */
  async addField(
    em: EntityManager,
    schema: string,
    table: string,
    field: { name: string; type: FieldType },
    relation?: RelationTarget,
  ): Promise<void> {
    const t = qualified(schema, table);
    const columns = columnsForField(field.name, field.type);
    await em.query(
      `ALTER TABLE ${t} ${columns.map((c) => `ADD COLUMN ${ident(c.column)} ${c.sqlType}`).join(', ')}`,
    );
    if (field.type === FieldType.RELATION) {
      if (!relation) throw new Error(`Relation field ${field.name} needs a target table`);
      const column = columns[0].column;
      await em.query(
        `ALTER TABLE ${t} ADD CONSTRAINT ${ident(constraintName('fk', schema, table, column))}
         FOREIGN KEY (${ident(column)}) REFERENCES ${qualified(schema, relation.table)} ("id")
         ON DELETE ${ON_DELETE_SQL[relation.onDelete]}`,
      );
      await em.query(
        `CREATE INDEX ${ident(constraintName('idx', schema, table, column))} ON ${t} (${ident(column)})`,
      );
    }
  }

  /** Permanently removes a field's columns (its foreign key and index go with them). */
  async dropField(
    em: EntityManager,
    schema: string,
    table: string,
    field: { name: string; type: FieldType },
  ): Promise<void> {
    const columns = columnsForField(field.name, field.type);
    await em.query(
      `ALTER TABLE ${qualified(schema, table)} ${columns.map((c) => `DROP COLUMN IF EXISTS ${ident(c.column)}`).join(', ')}`,
    );
  }

  /** When select options are removed, records using them are cleared rather than left invalid. */
  async clearRemovedOptions(
    em: EntityManager,
    schema: string,
    table: string,
    field: { name: string; type: FieldType },
    removedValues: string[],
  ): Promise<void> {
    if (!removedValues.length) return;
    const t = qualified(schema, table);
    const col = ident(columnsForField(field.name, field.type)[0].column);
    if (field.type === FieldType.SELECT) {
      await em.query(`UPDATE ${t} SET ${col} = NULL WHERE ${col} = ANY($1::text[])`, [
        removedValues,
      ]);
    } else if (field.type === FieldType.MULTI_SELECT) {
      await em.query(
        `UPDATE ${t} SET ${col} = ARRAY(SELECT v FROM unnest(${col}) AS v WHERE NOT v = ANY($1::text[]))
         WHERE ${col} && $1::text[]`,
        [removedValues],
      );
    }
  }

  /** When a rating's maximum is lowered, higher scores are capped to the new maximum. */
  async capRating(
    em: EntityManager,
    schema: string,
    table: string,
    field: { name: string },
    max: number,
  ): Promise<void> {
    const t = qualified(schema, table);
    const col = ident(columnsForField(field.name, FieldType.RATING)[0].column);
    await em.query(`UPDATE ${t} SET ${col} = $1 WHERE ${col} > $1`, [max]);
  }
}
