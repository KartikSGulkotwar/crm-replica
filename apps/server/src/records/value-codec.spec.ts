import { parseRecordInput, RecordValidationError, rowToRecord } from './value-codec';
import { testObjectModel } from './test-model';

const object = testObjectModel();
const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
    return [];
  } catch (e) {
    if (e instanceof RecordValidationError) return e.messages;
    throw e;
  }
}

describe('parseRecordInput', () => {
  it('converts valid values of every type to columns', () => {
    const parsed = parseRecordInput(
      object,
      {
        name: 'Big deal',
        amount: { amount: 1200.5 },
        probability: 0.4,
        isHot: true,
        closeDate: '2026-03-31',
        signedAt: '2026-03-01T10:00:00+01:00',
        stage: 'WON',
        tags: ['SMB', 'SMB'],
        contactEmail: ' Ada@Example.com ',
        phone: '+1 (555) 010-2000',
        website: 'acme.com',
        score: 3,
        companyId: UUID,
      },
      'create',
    );
    const byColumn = Object.fromEntries(parsed.columns.map((c) => [c.column, c.value]));
    expect(byColumn).toMatchObject({
      name: 'Big deal',
      amount_amount: 1200.5,
      amount_currency: 'EUR', // the field's default currency
      is_hot: true,
      close_date: '2026-03-31',
      signed_at: '2026-03-01T09:00:00.000Z',
      stage: 'WON',
      tags: ['SMB'],
      contact_email: 'ada@example.com',
      website: 'acme.com',
      score: 3,
      company_id: UUID,
    });
    expect(parsed.relationIds).toEqual([
      { field: expect.objectContaining({ name: 'company' }), id: UUID },
    ]);
  });

  it('applies defaults and enforces required fields on create', () => {
    expect(errorsOf(() => parseRecordInput(object, {}, 'create'))).toEqual(['name is required']);
    const parsed = parseRecordInput(object, { name: 'x' }, 'create');
    expect(parsed.columns).toContainEqual({ column: 'stage', value: 'NEW', cast: 'text' });
  });

  it('only touches the fields sent on update, but still checks required ones', () => {
    expect(parseRecordInput(object, { probability: 1 }, 'update').columns).toHaveLength(1);
    expect(errorsOf(() => parseRecordInput(object, { name: null }, 'update'))).toEqual([
      'name is required',
    ]);
  });

  it('reports every problem at once', () => {
    const errors = errorsOf(() =>
      parseRecordInput(
        object,
        {
          name: 5,
          probability: 'high',
          closeDate: '31/03/2026',
          signedAt: '2026-03-01T10:00:00', // no time zone
          stage: 'MAYBE',
          tags: ['NOPE'],
          contactEmail: 'not-an-email',
          website: 'not a link',
          score: 4,
          amount: { amount: 1, currency: 'dollars' },
          company: UUID,
          createdAt: '2020-01-01T00:00:00Z',
          mystery: 1,
        },
        'create',
      ),
    );
    expect(errors).toEqual([
      'name must be text',
      'probability must be a number',
      'closeDate must be a date like 2026-01-31',
      'signedAt must be an ISO date-time with a time zone, like 2026-01-31T09:00:00Z',
      'stage must be one of: NEW, WON, LOST',
      'tags must be a list of: ENTERPRISE, SMB',
      'contactEmail must be a valid email address',
      'website must be a valid web address',
      'score must be a whole number from 1 to 3',
      'amount currency must be a 3-letter code like USD',
      'Use companyId to set company',
      'createdAt is set automatically and can’t be changed',
      'Unknown field "mystery" on Opportunity',
    ]);
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, [], 'name=x', 3]) {
      expect(errorsOf(() => parseRecordInput(object, body, 'create'))).toEqual([
        'Body must be a JSON object',
      ]);
    }
  });
});

describe('rowToRecord', () => {
  it('formats columns for the API', () => {
    const record = rowToRecord(object, {
      id: UUID,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
      created_by: null,
      position: 3,
      name: 'Deal',
      amount_amount: '1200.50',
      amount_currency: 'EUR',
      tags: null,
      signed_at: new Date('2026-03-01T09:00:00Z'),
      company_id: UUID,
    });
    expect(record).toMatchObject({
      id: UUID,
      createdAt: '2026-01-01T00:00:00.000Z',
      position: 3,
      name: 'Deal',
      amount: { amount: 1200.5, currency: 'EUR' },
      tags: [],
      signedAt: '2026-03-01T09:00:00.000Z',
      companyId: UUID,
      probability: null,
    });
  });
});
