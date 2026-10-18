import { describe, expect, it } from 'vitest';
import { fromDateTimeLocal, linkHref, linkLabel, toDateTimeLocal } from './format';
import { recordLabel, searchFields } from './record-label';

describe('format helpers', () => {
  it('round-trips datetime-local values through ISO', () => {
    const iso = '2026-03-01T09:30:00.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
    expect(fromDateTimeLocal('')).toBeNull();
  });

  it('makes bare domains clickable and strips protocols for display', () => {
    expect(linkHref('acme.com')).toBe('https://acme.com');
    expect(linkHref('http://acme.com')).toBe('http://acme.com');
    expect(linkLabel('https://acme.com/')).toBe('acme.com');
  });
});

describe('recordLabel', () => {
  const company = {
    labelIdentifierFieldName: 'name',
    labelSingular: 'Company',
    fields: [{ name: 'name' }],
  } as never;
  const person = {
    labelIdentifierFieldName: 'firstName',
    labelSingular: 'Person',
    fields: [{ name: 'firstName' }, { name: 'lastName' }],
  } as never;

  it('uses the title field, and full names for people', () => {
    expect(recordLabel(company, { name: 'Acme' } as never)).toBe('Acme');
    expect(recordLabel(person, { firstName: 'Ada', lastName: 'Lovelace' } as never)).toBe(
      'Ada Lovelace',
    );
    expect(recordLabel(person, { firstName: null, lastName: 'Lovelace' } as never)).toBe(
      'Lovelace',
    );
  });

  it('falls back for untitled records', () => {
    expect(recordLabel(company, { name: '  ' } as never)).toBe('Untitled company');
  });

  it('searches first and last names for people', () => {
    expect(searchFields(person)).toEqual(['firstName', 'lastName']);
    expect(searchFields(company)).toEqual(['name']);
  });
});
