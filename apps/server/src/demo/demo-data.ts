/**
 * A believable, made-up sales pipeline: 30 companies, 60 people, 40 opportunities, plus notes
 * and tasks linked to them. Deterministic (same output for the same day), so screenshots and
 * tests are stable. Every company, person and domain here is fictional.
 */

type Industry =
  'SOFTWARE' | 'FINANCE' | 'HEALTHCARE' | 'RETAIL' | 'MANUFACTURING' | 'EDUCATION' | 'OTHER';
type Stage = 'NEW' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST';

export interface DemoCompany {
  key: string;
  values: {
    name: string;
    domain: string;
    employees: number;
    industry: Industry;
    annualRevenue: { amount: number; currency: string };
  };
}
export interface DemoPerson {
  key: string;
  company: string;
  values: { firstName: string; lastName: string; email: string; phone: string; jobTitle: string };
}
export interface DemoOpportunity {
  key: string;
  company: string;
  contact: string;
  values: {
    name: string;
    amount: { amount: number; currency: string };
    stage: Stage;
    closeDate: string;
  };
}
export interface DemoNote {
  targets: string[];
  values: { title: string; body: string };
}
export interface DemoTask {
  targets: string[];
  values: {
    title: string;
    body: string;
    dueDate: string;
    status: 'TO_DO' | 'IN_PROGRESS' | 'DONE';
  };
}
export interface DemoData {
  companies: DemoCompany[];
  people: DemoPerson[];
  opportunities: DemoOpportunity[];
  notes: DemoNote[];
  tasks: DemoTask[];
}

const COMPANIES: [string, Industry][] = [
  ['Acme Robotics', 'MANUFACTURING'],
  ['Bluefin Analytics', 'SOFTWARE'],
  ['Cedar & Pine Furniture', 'RETAIL'],
  ['Driftwood Labs', 'SOFTWARE'],
  ['Emberline Energy', 'OTHER'],
  ['Foxglove Health', 'HEALTHCARE'],
  ['Granite Peak Capital', 'FINANCE'],
  ['Harborlight Logistics', 'OTHER'],
  ['Ironbark Manufacturing', 'MANUFACTURING'],
  ['Juniper Learning', 'EDUCATION'],
  ['Kestrel Aerospace', 'MANUFACTURING'],
  ['Lumen Outfitters', 'RETAIL'],
  ['Maple Street Credit Union', 'FINANCE'],
  ['Nimbus Cloudworks', 'SOFTWARE'],
  ['Oakridge Clinics', 'HEALTHCARE'],
  ['Pinecone Software', 'SOFTWARE'],
  ['Quartzline Payments', 'FINANCE'],
  ['Riverbend Foods', 'RETAIL'],
  ['Saltmarsh Coffee', 'RETAIL'],
  ['Tidewater Insurance', 'FINANCE'],
  ['Umberstone Studio', 'OTHER'],
  ['Verdant Farms', 'OTHER'],
  ['Willowbrook Academy', 'EDUCATION'],
  ['Xylo Devices', 'MANUFACTURING'],
  ['Yarrow Pharmacy', 'HEALTHCARE'],
  ['Zephyr Wind Power', 'OTHER'],
  ['Brightside Dental', 'HEALTHCARE'],
  ['Copperleaf Bank', 'FINANCE'],
  ['Dovetail Hardware', 'RETAIL'],
  ['Evergreen Tutors', 'EDUCATION'],
];

const FIRST = [
  'Ada',
  'Ben',
  'Chloe',
  'Diego',
  'Elena',
  'Farah',
  'Gabriel',
  'Hana',
  'Ivan',
  'Jade',
  'Kofi',
  'Lena',
  'Mateo',
  'Nadia',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Sami',
  'Tara',
  'Uma',
  'Victor',
  'Wen',
  'Ximena',
  'Yusuf',
  'Zoe',
  'Arjun',
  'Bea',
  'Caleb',
  'Dana',
];
const LAST = [
  'Okafor',
  'Lindqvist',
  'Moreau',
  'Hernández',
  'Novak',
  'Haddad',
  'Silva',
  'Tanaka',
  'Petrov',
  'Murphy',
  'Mensah',
  'Fischer',
  'Rossi',
  'Kowalski',
  'Farouk',
  'Raman',
  'Byrne',
  'Castillo',
  'Nakamura',
  'Ahmed',
  'Patel',
  'Larsen',
  'Chen',
  'Vargas',
  'Demir',
  'Walsh',
  'Iyer',
  'Duarte',
  'Brooks',
  'Kim',
];
const TITLES = [
  'Head of Operations',
  'CTO',
  'VP Sales',
  'Procurement Manager',
  'CFO',
  'Founder & CEO',
  'IT Director',
  'Office Manager',
  'Product Lead',
  'COO',
];
const DEALS = ['Annual license', 'Pilot', 'Expansion', 'Renewal', 'Support plan', 'Onboarding'];
/** 40 deals: 8 new, 9 qualified, 9 proposal, 8 won, 6 lost. */
const STAGES: Stage[] = [
  ...Array<Stage>(8).fill('NEW'),
  ...Array<Stage>(9).fill('QUALIFIED'),
  ...Array<Stage>(9).fill('PROPOSAL'),
  ...Array<Stage>(8).fill('WON'),
  ...Array<Stage>(6).fill('LOST'),
];

/** A small seeded random generator, so the data is the same every time. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
const ascii = (text: string) => text.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
const dayOffset = (today: Date, days: number) => {
  const d = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days),
  );
  return d.toISOString().slice(0, 10);
};

export function buildDemoData(today = new Date()): DemoData {
  const rand = random(42);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const round = (n: number, step: number) => Math.round(n / step) * step;

  const companies: DemoCompany[] = COMPANIES.map(([name, industry], i) => {
    const employees = round(10 + rand() * 2000, 5);
    return {
      key: `c${i}`,
      values: {
        name,
        domain: `${slug(name)}.example.com`,
        employees,
        industry,
        annualRevenue: {
          amount: round(employees * (60_000 + rand() * 140_000), 100_000),
          currency: 'USD',
        },
      },
    };
  });

  const people: DemoPerson[] = [];
  for (let i = 0; i < 60; i++) {
    const company = companies[i % 30];
    const firstName = FIRST[i % FIRST.length];
    // The second person at each company gets a different surname pattern (no duplicates).
    const lastName = LAST[(i * 7 + Math.floor(i / 30) * 11) % LAST.length];
    people.push({
      key: `p${i}`,
      company: company.key,
      values: {
        firstName,
        lastName,
        email: `${ascii(firstName)}.${ascii(lastName)}@${company.values.domain}`.toLowerCase(),
        phone: `+1 555 01${String(i).padStart(2, '0')}`,
        jobTitle: TITLES[(i * 3) % TITLES.length],
      },
    });
  }

  const opportunities: DemoOpportunity[] = STAGES.map((stage, i) => {
    // Every company gets a deal; ten of them get a second one, with their other contact.
    const second = i >= companies.length;
    const company = companies[second ? (i * 7) % companies.length : i];
    const contact = people.filter((p) => p.company === company.key)[second ? 1 : 0];
    const deal = DEALS[(i + (second ? 3 : 0)) % DEALS.length];
    const open = stage !== 'WON' && stage !== 'LOST';
    // Open deals close in the next three months; closed ones closed in the last two.
    const days = open ? Math.floor(rand() * 90) - 5 : -Math.floor(5 + rand() * 60);
    return {
      key: `o${i}`,
      company: company.key,
      contact: contact.key,
      values: {
        name: `${company.values.name.split(' ')[0]} ${deal.toLowerCase()}`,
        amount: { amount: round(5_000 + rand() * 245_000, 500), currency: 'USD' },
        stage,
        closeDate: dayOffset(today, days),
      },
    };
  });

  const notes: DemoNote[] = [];
  const NOTE_TEMPLATES = [
    (o: string) => ({
      title: 'Discovery call',
      body: `Walked through current process. Main pain: manual reporting. Budget approved for ${o}.`,
    }),
    () => ({
      title: 'Pricing questions',
      body: 'Asked about volume discounts and a two-year term. Sent the pricing sheet.',
    }),
    () => ({
      title: 'Security review',
      body: 'They need our security questionnaire and a data processing agreement before signing.',
    }),
    () => ({
      title: 'Champion moved roles',
      body: 'Our main contact is moving teams next month; need to meet their replacement.',
    }),
  ];
  opportunities.slice(0, 24).forEach((o, i) => {
    const content = NOTE_TEMPLATES[i % NOTE_TEMPLATES.length](o.values.name);
    notes.push({ targets: [o.key, o.company], values: content });
  });

  const tasks: DemoTask[] = [];
  const TASKS = [
    'Send proposal',
    'Follow up on pricing',
    'Book demo',
    'Check in after pilot',
    'Prepare contract',
  ];
  opportunities
    .filter((o) => o.values.stage !== 'LOST')
    .slice(0, 30)
    .forEach((o, i) => {
      const done = o.values.stage === 'WON' || i % 5 === 0;
      const status = done ? 'DONE' : i % 3 === 0 ? 'IN_PROGRESS' : 'TO_DO';
      tasks.push({
        targets: [o.key, o.contact],
        values: {
          title: `${pick(TASKS)}: ${o.values.name}`,
          body: '',
          // Some overdue, some today, most in the next two weeks.
          dueDate: `${dayOffset(today, done ? -Math.floor(1 + rand() * 20) : Math.floor(rand() * 16) - 3)}T15:00:00.000Z`,
          status,
        },
      });
    });

  return { companies, people, opportunities, notes, tasks };
}
