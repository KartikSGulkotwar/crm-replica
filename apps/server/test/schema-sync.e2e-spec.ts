import { FIELD_TYPES, FieldType } from '@crm-replica/shared';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { workspaceSchemaName } from '../src/database/workspace-schema';
import { columnsForField } from '../src/schema-sync/column-mapping';
import { SchemaSyncService } from '../src/schema-sync/schema-sync.service';
import { createTestApp, TestApp } from './utils/test-app';

/** Postgres data_type (information_schema) expected for each column type we generate. */
const PG_TYPE: Record<string, string> = {
  text: 'text',
  'double precision': 'double precision',
  'numeric(18,2)': 'numeric',
  boolean: 'boolean',
  date: 'date',
  timestamptz: 'timestamp with time zone',
  'text[]': 'ARRAY',
  smallint: 'smallint',
  uuid: 'uuid',
};

describe('SchemaSyncService (e2e, real Postgres)', () => {
  let t: TestApp;
  let ds: DataSource;
  let sync: SchemaSyncService;
  let schema: string;

  const columnsOf = async (table: string) =>
    Object.fromEntries(
      (
        await ds.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
          [schema, table],
        )
      ).map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]),
    );

  const tableExists = async (table: string) =>
    (
      await ds.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      )
    ).length === 1;

  beforeAll(async () => {
    t = await createTestApp();
    ds = t.dataSource;
    sync = t.app.get(SchemaSyncService);
    schema = workspaceSchemaName(randomUUID());
    await ds.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    await ds?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await t?.close();
  });

  it('creates a table with the system columns', async () => {
    await ds.transaction((em) => sync.createTable(em, schema, 'widgets'));
    expect(await columnsOf('widgets')).toEqual({
      id: 'uuid',
      created_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone',
      deleted_at: 'timestamp with time zone',
      created_by: 'uuid',
      position: 'double precision',
    });
    const [row] = await ds.query(`INSERT INTO "${schema}"."widgets" DEFAULT VALUES RETURNING *`);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.position).toBe(0);
  });

  it.each(FIELD_TYPES.filter((type) => type !== FieldType.RELATION))(
    'adds a %s field with the right column types',
    async (type) => {
      const name = `my${type.charAt(0)}${type
        .slice(1)
        .toLowerCase()
        .replace(/_(\w)/g, (_, c) => c.toUpperCase())}`;
      await ds.transaction((em) => sync.addField(em, schema, 'widgets', { name, type }));
      const columns = await columnsOf('widgets');
      for (const spec of columnsForField(name, type))
        expect(columns[spec.column]).toBe(PG_TYPE[spec.sqlType]);
    },
  );

  it('adds a RELATION field as a uuid column with a foreign key', async () => {
    await ds.transaction(async (em) => {
      await sync.createTable(em, schema, 'owners');
      await sync.addField(
        em,
        schema,
        'widgets',
        { name: 'owner', type: FieldType.RELATION },
        { table: 'owners', onDelete: 'SET_NULL' },
      );
    });
    expect((await columnsOf('widgets')).owner_id).toBe('uuid');

    const [owner] = await ds.query(`INSERT INTO "${schema}"."owners" DEFAULT VALUES RETURNING id`);
    const [widget] = await ds.query(
      `INSERT INTO "${schema}"."widgets" (owner_id) VALUES ($1) RETURNING id`,
      [owner.id],
    );
    await expect(
      ds.query(`INSERT INTO "${schema}"."widgets" (owner_id) VALUES ($1)`, [randomUUID()]),
    ).rejects.toThrow(/foreign key/);

    // ON DELETE SET NULL: removing the owner clears the link instead of failing.
    await ds.query(`DELETE FROM "${schema}"."owners" WHERE id = $1`, [owner.id]);
    const [after] = await ds.query(`SELECT owner_id FROM "${schema}"."widgets" WHERE id = $1`, [
      widget.id,
    ]);
    expect(after.owner_id).toBeNull();
  });

  it('rolls back DDL together with the transaction', async () => {
    await expect(
      ds.transaction(async (em) => {
        await sync.createTable(em, schema, 'ghosts');
        throw new Error('metadata save failed');
      }),
    ).rejects.toThrow('metadata save failed');
    expect(await tableExists('ghosts')).toBe(false);
  });

  it('clears removed select options from records', async () => {
    await ds.transaction(async (em) => {
      await sync.addField(em, schema, 'widgets', { name: 'stage', type: FieldType.SELECT });
      await sync.addField(em, schema, 'widgets', { name: 'tags', type: FieldType.MULTI_SELECT });
    });
    const [w] = await ds.query(
      `INSERT INTO "${schema}"."widgets" (stage, tags) VALUES ('LOST', ARRAY['A','B','C']) RETURNING id`,
    );
    await ds.transaction(async (em) => {
      await sync.clearRemovedOptions(
        em,
        schema,
        'widgets',
        { name: 'stage', type: FieldType.SELECT },
        ['LOST'],
      );
      await sync.clearRemovedOptions(
        em,
        schema,
        'widgets',
        { name: 'tags', type: FieldType.MULTI_SELECT },
        ['B'],
      );
    });
    const [row] = await ds.query(`SELECT stage, tags FROM "${schema}"."widgets" WHERE id = $1`, [
      w.id,
    ]);
    expect(row).toEqual({ stage: null, tags: ['A', 'C'] });
  });

  it('caps ratings when the maximum is lowered', async () => {
    await ds.transaction((em) =>
      sync.addField(em, schema, 'widgets', { name: 'score', type: FieldType.RATING }),
    );
    const [w] = await ds.query(`INSERT INTO "${schema}"."widgets" (score) VALUES (5) RETURNING id`);
    await ds.transaction((em) => sync.capRating(em, schema, 'widgets', { name: 'score' }, 3));
    const [row] = await ds.query(`SELECT score FROM "${schema}"."widgets" WHERE id = $1`, [w.id]);
    expect(row.score).toBe(3);
  });

  it('drops a field’s columns, including both currency columns', async () => {
    await ds.transaction((em) =>
      sync.dropField(em, schema, 'widgets', { name: 'myCurrency', type: FieldType.CURRENCY }),
    );
    const columns = await columnsOf('widgets');
    expect(columns).not.toHaveProperty('my_currency_amount');
    expect(columns).not.toHaveProperty('my_currency_currency');
  });

  it('drops a table', async () => {
    await ds.transaction((em) => sync.dropTable(em, schema, 'widgets'));
    expect(await tableExists('widgets')).toBe(false);
  });

  it('refuses unsafe identifiers before running any SQL', async () => {
    await expect(
      ds.transaction((em) => sync.createTable(em, schema, 'x"; DROP SCHEMA core CASCADE; --')),
    ).rejects.toThrow('unsafe SQL identifier');
    await expect(ds.transaction((em) => sync.createTable(em, 'core', 'evil'))).rejects.toThrow(
      'unsafe schema name',
    );
    expect(
      (await ds.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core'`))
        .length,
    ).toBe(1);
  });
});
