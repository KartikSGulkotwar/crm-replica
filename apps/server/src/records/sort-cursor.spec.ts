import { FilterError } from './filter-builder';
import { parseSortParam, SortPlan } from './sort-cursor';
import { SqlParams } from './sql-params';
import { testObjectModel } from './test-model';

const object = testObjectModel();

describe('parseSortParam', () => {
  it('defaults to manual order', () => {
    expect(parseSortParam(object, undefined).map((k) => [k.field.name, k.direction])).toEqual([
      ['position', 'asc'],
    ]);
  });

  it('parses several keys', () => {
    expect(
      parseSortParam(object, 'amount:desc,name').map((k) => [k.field.name, k.direction]),
    ).toEqual([
      ['amount', 'desc'],
      ['name', 'asc'],
    ]);
  });

  it.each([
    ['nope:asc', 'Unknown sort field'],
    ['name:sideways', 'Invalid sort'],
    ['name:asc:x', 'Invalid sort'],
    ['tags', 'Can’t sort by tags'],
    ['company', 'Can’t sort by company'],
    ['id', 'Can’t sort by ID'],
    ['name,name:desc', 'only once'],
    ['name"; DROP TABLE x; --', 'Unknown sort field'],
    ['a,b,c,d,e,f', 'At most 5'],
  ])('rejects %s', (raw, message) => {
    expect(() => parseSortParam(object, raw)).toThrow(FilterError);
    expect(() => parseSortParam(object, raw)).toThrow(message);
  });
});

describe('SortPlan', () => {
  it('orders with NULLS LAST and id as tiebreaker; selects sort by option order', () => {
    const params = new SqlParams();
    const plan = new SortPlan(parseSortParam(object, 'stage:desc,closeDate'), params);
    expect(plan.orderBy()).toBe(
      'array_position($1::text[], t."stage") DESC NULLS LAST, t."close_date" ASC NULLS LAST, t."id" ASC',
    );
    expect(params.values).toEqual([['NEW', 'WON', 'LOST']]);
  });

  it('round-trips a cursor into a keyset condition with bound values', () => {
    const plan = new SortPlan(parseSortParam(object, 'name'), new SqlParams());
    const cursor = plan.encodeCursor({
      __sort_0: 'Acme',
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    const params = new SqlParams();
    expect(plan.afterCursor(cursor, params)).toBe(
      '(((t."name" > $1::text OR t."name" IS NULL)) OR (t."name" = $2::text AND t."id" > $3::uuid))',
    );
    expect(params.values).toEqual(['Acme', 'Acme', '3f2504e0-4f89-11d3-9a0c-0305e82c3301']);
  });

  it('handles a cursor sitting on a NULL value (only later nulls follow)', () => {
    const plan = new SortPlan(parseSortParam(object, 'name'), new SqlParams());
    const cursor = plan.encodeCursor({
      __sort_0: null,
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    expect(plan.afterCursor(cursor, new SqlParams())).toBe(
      '((FALSE) OR (t."name" IS NULL AND t."id" > $1::uuid))',
    );
  });

  it('rejects cursors from another sort, and tampered cursors', () => {
    const byName = new SortPlan(parseSortParam(object, 'name'), new SqlParams());
    const cursor = byName.encodeCursor({
      __sort_0: 'A',
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    const byAmount = new SortPlan(parseSortParam(object, 'amount'), new SqlParams());
    expect(() => byAmount.afterCursor(cursor, new SqlParams())).toThrow('different sort');
    expect(() => byName.afterCursor('not-base64-json', new SqlParams())).toThrow('Invalid cursor');
    const tampered = Buffer.from(JSON.stringify({ s: 'name:asc', v: [{ evil: 1 }, 'x'] })).toString(
      'base64url',
    );
    expect(() => byName.afterCursor(tampered, new SqlParams())).toThrow('Invalid cursor');
  });
});
