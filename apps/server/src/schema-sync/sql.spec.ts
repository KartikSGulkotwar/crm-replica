import { ident, qualified } from './sql';

describe('SQL identifier quoting', () => {
  it('quotes safe snake_case names', () => {
    expect(ident('annual_revenue')).toBe('"annual_revenue"');
    expect(qualified('workspace_3f2504e04f8911d39a0c0305e82c3301', 'companies')).toBe(
      '"workspace_3f2504e04f8911d39a0c0305e82c3301"."companies"',
    );
  });

  it.each([
    'Name',
    'name"; DROP TABLE x; --',
    'a b',
    'name--',
    '1abc',
    '',
    'a'.repeat(64),
    'naïve',
    'x"y',
  ])('rejects %j', (name) => {
    expect(() => ident(name)).toThrow('unsafe SQL identifier');
  });

  it('rejects schemas that are not workspace schemas', () => {
    expect(() => qualified('core', 'user')).toThrow('unsafe schema name');
    expect(() => qualified('public', 'companies')).toThrow('unsafe schema name');
  });
});
