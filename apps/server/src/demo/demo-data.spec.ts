import { buildDemoData } from './demo-data';

describe('buildDemoData', () => {
  const today = new Date('2026-10-20T12:00:00Z');
  const data = buildDemoData(today);

  it('has the sizes the spec asks for, with notes and tasks', () => {
    expect(data.companies).toHaveLength(30);
    expect(data.people).toHaveLength(60);
    expect(data.opportunities).toHaveLength(40);
    expect(data.notes.length).toBeGreaterThanOrEqual(20);
    expect(data.tasks.length).toBeGreaterThanOrEqual(20);
  });

  it('is the same every time (stable screenshots and tests)', () => {
    expect(buildDemoData(today)).toEqual(data);
  });

  it('only refers to records it creates, with unique emails and names', () => {
    const keys = new Set(
      [...data.companies, ...data.people, ...data.opportunities].map((r) => r.key),
    );
    for (const p of data.people) expect(keys.has(p.company)).toBe(true);
    for (const o of data.opportunities) {
      expect(keys.has(o.company)).toBe(true);
      expect(keys.has(o.contact)).toBe(true);
    }
    for (const a of [...data.notes, ...data.tasks])
      for (const k of a.targets) expect(keys.has(k)).toBe(true);
    const emails = data.people.map((p) => p.values.email);
    expect(new Set(emails).size).toBe(60);
    expect(emails.every((e) => /^[a-z.]+@[a-z0-9.]+\.example\.com$/.test(e))).toBe(true);
    expect(new Set(data.companies.map((c) => c.values.name)).size).toBe(30);
    expect(new Set(data.opportunities.map((o) => o.values.name)).size).toBe(40);
    // Every company has at least one deal.
    expect(new Set(data.opportunities.map((o) => o.company)).size).toBe(30);
  });

  it('spreads deals over every stage, with open deals closing soon and closed ones in the past', () => {
    const count = (stage: string) =>
      data.opportunities.filter((o) => o.values.stage === stage).length;
    expect(['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'].map(count)).toEqual([8, 9, 9, 8, 6]);
    for (const o of data.opportunities) {
      const closed = o.values.stage === 'WON' || o.values.stage === 'LOST';
      if (closed) expect(o.values.closeDate < '2026-10-20').toBe(true);
      else
        expect(o.values.closeDate >= '2026-10-15' && o.values.closeDate <= '2027-01-18').toBe(true);
    }
  });
});
