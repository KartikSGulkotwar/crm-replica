import { buildFilterSql, FilterError, parseFilterParam } from './filter-builder';
import { SqlParams } from './sql-params';
import { testObjectModel } from './test-model';

const object = testObjectModel();

function build(filter: unknown) {
  const params = new SqlParams();
  const sql = buildFilterSql(object, filter, params);
  return { sql, values: params.values };
}

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('buildFilterSql', () => {
  describe('operators by field type', () => {
    it.each([
      [{ field: 'name', op: 'eq', value: 'Acme' }, 't."name" = $1::text', ['Acme']],
      [{ field: 'name', op: 'neq', value: 'Acme' }, 't."name" IS DISTINCT FROM $1::text', ['Acme']],
      [
        { field: 'name', op: 'contains', value: 'acme' },
        `t."name" ILIKE $1::text ESCAPE '\\'`,
        ['%acme%'],
      ],
      [
        { field: 'name', op: 'startsWith', value: 'Ac' },
        `t."name" ILIKE $1::text ESCAPE '\\'`,
        ['Ac%'],
      ],
      [
        { field: 'name', op: 'notContains', value: 'x' },
        `(t."name" IS NULL OR NOT (t."name" ILIKE $1::text ESCAPE '\\'))`,
        ['%x%'],
      ],
      [{ field: 'name', op: 'isEmpty' }, `(t."name" IS NULL OR t."name" = '')`, []],
      [{ field: 'name', op: 'isNotEmpty' }, `NOT (t."name" IS NULL OR t."name" = '')`, []],
      [
        { field: 'probability', op: 'gt', value: 0.5 },
        't."probability" > $1::double precision',
        [0.5],
      ],
      [{ field: 'amount', op: 'gte', value: 50000 }, 't."amount_amount" >= $1::numeric', [50000]],
      [{ field: 'score', op: 'lte', value: 2 }, 't."score" <= $1::integer', [2]],
      [
        { field: 'isHot', op: 'eq', value: false },
        'COALESCE(t."is_hot", false) = $1::boolean',
        [false],
      ],
      [
        { field: 'closeDate', op: 'lt', value: '2026-12-31' },
        't."close_date" < $1::date',
        ['2026-12-31'],
      ],
      [
        { field: 'signedAt', op: 'gte', value: '2026-01-01' },
        't."signed_at" >= $1::timestamptz',
        ['2026-01-01T00:00:00.000Z'],
      ],
      [
        { field: 'createdAt', op: 'lt', value: '2026-01-01T12:00:00+02:00' },
        't."created_at" < $1::timestamptz',
        ['2026-01-01T10:00:00.000Z'],
      ],
      [
        { field: 'stage', op: 'in', value: ['NEW', 'WON'] },
        't."stage" = ANY($1::text[])',
        [['NEW', 'WON']],
      ],
      [
        { field: 'stage', op: 'notIn', value: ['LOST'] },
        '(t."stage" IS NULL OR NOT (t."stage" = ANY($1::text[])))',
        [['LOST']],
      ],
      [{ field: 'tags', op: 'containsAny', value: ['SMB'] }, 't."tags" && $1::text[]', [['SMB']]],
      [
        { field: 'tags', op: 'containsAll', value: ['SMB', 'ENTERPRISE'] },
        't."tags" @> $1::text[]',
        [['SMB', 'ENTERPRISE']],
      ],
      [{ field: 'tags', op: 'isEmpty' }, '(t."tags" IS NULL OR cardinality(t."tags") = 0)', []],
      [{ field: 'company', op: 'eq', value: UUID }, 't."company_id" = $1::uuid', [UUID]],
      [{ field: 'companyId', op: 'isEmpty' }, 't."company_id" IS NULL', []],
      [{ field: 'id', op: 'in', value: [UUID] }, 't."id" = ANY($1::uuid[])', [[UUID]]],
    ])('%j', (filter, sql, values) => {
      expect(build(filter)).toEqual({ sql, values });
    });

    it('combines and / or / not with numbered parameters', () => {
      const { sql, values } = build({
        or: [
          {
            and: [
              { field: 'name', op: 'contains', value: 'acme' },
              { field: 'amount', op: 'gt', value: 10 },
            ],
          },
          { not: { field: 'stage', op: 'eq', value: 'LOST' } },
        ],
      });
      expect(sql).toBe(
        `((t."name" ILIKE $1::text ESCAPE '\\' AND t."amount_amount" > $2::numeric) OR NOT (t."stage" = $3::text))`,
      );
      expect(values).toEqual(['%acme%', 10, 'LOST']);
    });
  });

  describe('rejects invalid filters', () => {
    it.each([
      [{ field: 'nope', op: 'eq', value: 1 }, 'Unknown field "nope"'],
      [
        { field: 'tags', op: 'contains', value: 'x' },
        'Operator "contains" isn’t supported for tags',
      ],
      [{ field: 'name', op: 'gt', value: 'a' }, 'Operator "gt" isn’t supported'],
      [{ field: 'probability', op: 'eq', value: '5' }, 'must be a number'],
      [{ field: 'probability', op: 'eq', value: Infinity }, 'must be a number'],
      [{ field: 'closeDate', op: 'eq', value: '2026-02-30' }, 'must be a date'],
      [{ field: 'stage', op: 'eq', value: 'MAYBE' }, 'must be one of: NEW, WON, LOST'],
      [{ field: 'company', op: 'eq', value: 'not-a-uuid' }, 'record id (uuid)'],
      [{ field: 'stage', op: 'in', value: [] }, 'needs a list of 1 to 200'],
      [{ field: 'stage', op: 'in', value: 'NEW' }, 'needs a list'],
      [{ field: 'name', op: 'eq' }, 'must be text'],
      [{ field: 'name' }, 'needs an "op"'],
      [{ op: 'eq', value: 1 }, 'needs a "field"'],
      [{ and: [] }, '"and" needs a non-empty list'],
      [{ and: [{ field: 'name', op: 'isEmpty' }], or: [] }, '"and" must be the only key'],
      [[], 'must be an object'],
      ['name = 1', 'must be an object'],
      [null, 'must be an object'],
    ])('%j', (filter, message) => {
      expect(() => build(filter)).toThrow(FilterError);
      expect(() => build(filter)).toThrow(message);
    });

    it('limits nesting depth', () => {
      let deep: unknown = { field: 'name', op: 'isEmpty' };
      for (let i = 0; i < 10; i++) deep = { not: deep };
      expect(() => build(deep)).toThrow('nested at most');
    });

    it('limits the number of conditions', () => {
      const many = Array.from({ length: 51 }, () => ({ field: 'name', op: 'isEmpty' }));
      expect(() => build({ and: many })).toThrow('at most 50 conditions');
    });
  });

  describe('SQL injection attempts', () => {
    const payloads = [
      `'; DROP TABLE opportunities; --`,
      `' OR '1'='1`,
      `acme' UNION SELECT password_hash FROM core."user" --`,
      `\\'; SELECT pg_sleep(10); --`,
      `$1`,
      `"name"`,
    ];

    it.each(payloads)(
      'binds %j as a parameter; the SQL text is always the fixed template',
      (payload) => {
        expect(build({ field: 'name', op: 'eq', value: payload })).toEqual({
          sql: 't."name" = $1::text',
          values: [payload],
        });
        expect(build({ field: 'name', op: 'neq', value: payload })).toEqual({
          sql: 't."name" IS DISTINCT FROM $1::text',
          values: [payload],
        });
        const contains = build({ field: 'name', op: 'contains', value: payload });
        expect(contains.sql).toBe(`t."name" ILIKE $1::text ESCAPE '\\'`);
        expect(contains.values).toEqual([`%${payload.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]);
      },
    );

    it.each([
      `name" = 'x' OR 1=1 --`,
      `name"; DROP TABLE opportunities; --`,
      `t.name`,
      `"name"`,
      `name OR 1=1`,
      `__proto__`,
      `constructor`,
      `toString`,
      `deleted_at`,
      `deletedAt`,
      `password_hash`,
    ])('rejects the field name %j (only metadata fields are allowed)', (field) => {
      expect(() => build({ field, op: 'eq', value: 'x' })).toThrow(`Unknown field`);
    });

    it.each([`eq; DROP TABLE x`, `= 1 OR 1=1 --`, `__proto__`, `ILIKE`])(
      'rejects the operator %j',
      (op) => {
        expect(() => build({ field: 'name', op, value: 'x' })).toThrow('isn’t supported');
      },
    );

    it('escapes LIKE wildcards so % and _ match literally', () => {
      expect(build({ field: 'name', op: 'contains', value: '100%_off\\' }).values).toEqual([
        '%100\\%\\_off\\\\%',
      ]);
    });

    it('rejects extra keys that could smuggle SQL', () => {
      expect(() => build({ field: 'name', op: 'eq', value: 'x', sql: '1=1' })).toThrow(
        'Unknown keys',
      );
    });

    it('rejects non-string elements smuggled into lists', () => {
      expect(() =>
        build({ field: 'id', op: 'in', value: [UUID, `x'); DROP TABLE y; --`] }),
      ).toThrow('record id');
    });
  });
});

describe('parseFilterParam', () => {
  it('parses JSON and reports invalid JSON clearly', () => {
    expect(parseFilterParam('{"field":"name","op":"isEmpty"}')).toEqual({
      field: 'name',
      op: 'isEmpty',
    });
    expect(parseFilterParam(undefined)).toBeUndefined();
    expect(() => parseFilterParam('{nope')).toThrow('valid JSON');
    expect(() => parseFilterParam(['a', 'b'])).toThrow('single JSON value');
  });
});
