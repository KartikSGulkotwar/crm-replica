import { describe, expect, it } from 'vitest';
import { flattenSteps, StepType, TriggerType, workflowDefinitionSchema } from './definition';
import { collectVariables, evaluateConditions, getPath, resolveTemplates } from './templates';

const context = {
  trigger: {
    record: {
      id: 'r1',
      name: 'Acme deal',
      stage: 'WON',
      amount: { amount: 75000, currency: 'USD' },
      tags: ['VIP', 'EU'],
      closeDate: '2026-03-01',
    },
  },
  steps: {
    find_company: {
      result: { first: { id: 'c1', name: 'Acme' }, records: [{ id: 'c1' }, { id: 'c2' }] },
    },
  },
};

describe('resolveTemplates', () => {
  it('keeps the type of a lone variable and interpolates mixed text', () => {
    expect(resolveTemplates('{{trigger.record.amount}}', context)).toEqual({
      amount: 75000,
      currency: 'USD',
    });
    expect(resolveTemplates('{{ trigger.record.amount.amount }}', context)).toBe(75000);
    expect(
      resolveTemplates('Deal {{trigger.record.name}} is {{trigger.record.stage}}!', context),
    ).toBe('Deal Acme deal is WON!');
    expect(resolveTemplates('{{steps.find_company.result.records.1.id}}', context)).toBe('c2');
  });

  it('resolves nested objects and arrays, and leaves non-strings alone', () => {
    expect(
      resolveTemplates(
        {
          title: 'Follow up {{trigger.record.name}}',
          n: 3,
          list: ['{{steps.find_company.result.first.id}}'],
        },
        context,
      ),
    ).toEqual({
      title: 'Follow up Acme deal',
      n: 3,
      list: ['c1'],
    });
  });

  it('turns missing values into null (lone) or empty text (mixed)', () => {
    expect(resolveTemplates('{{trigger.record.nope}}', context)).toBeNull();
    expect(resolveTemplates('x{{trigger.nope.deep}}y', context)).toBe('xy');
  });

  it('never reads from prototypes', () => {
    expect(getPath(context, '__proto__')).toBeUndefined();
    expect(getPath(context, 'trigger.constructor')).toBeUndefined();
    expect(getPath(context, 'trigger.record.name.length')).toBeUndefined();
    expect(resolveTemplates('{{constructor.constructor}}', context)).toBeNull();
  });

  it('collects variables for validation', () => {
    expect(
      collectVariables({ a: '{{trigger.record.id}}', b: ['x {{steps.s1.result.id}}'] }),
    ).toEqual(['trigger.record.id', 'steps.s1.result.id']);
  });
});

describe('evaluateConditions', () => {
  const run = (
    conditions: { left: string; op: string; right?: string }[],
    match: 'all' | 'any' = 'all',
  ) => evaluateConditions({ match, conditions: conditions as never }, context);

  it.each([
    [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }, true],
    [{ left: '{{trigger.record.stage}}', op: 'neq', right: 'WON' }, false],
    [{ left: '{{trigger.record.amount.amount}}', op: 'gte', right: '50000' }, true],
    [{ left: '{{trigger.record.amount.amount}}', op: 'lt', right: '9000' }, false],
    [{ left: '{{trigger.record.closeDate}}', op: 'gt', right: '2026-02-01' }, true],
    [{ left: '{{trigger.record.name}}', op: 'contains', right: 'ACME' }, true],
    [{ left: '{{trigger.record.tags}}', op: 'contains', right: 'VIP' }, true],
    [{ left: '{{trigger.record.tags}}', op: 'notContains', right: 'US' }, true],
    [{ left: '{{trigger.record.missing}}', op: 'isEmpty' }, true],
    [{ left: '{{trigger.record.name}}', op: 'isNotEmpty' }, true],
    [{ left: '{{trigger.record.name}}', op: 'gt', right: '{{trigger.record.amount}}' }, false],
  ])('%j → %s', (condition, expected) => expect(run([condition])).toBe(expected));

  it('combines with all / any; empty groups are true', () => {
    const a = { left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' };
    const b = { left: '{{trigger.record.stage}}', op: 'eq', right: 'LOST' };
    expect(run([a, b])).toBe(false);
    expect(run([a, b], 'any')).toBe(true);
    expect(run([])).toBe(true);
    expect(evaluateConditions(undefined, context)).toBe(true);
  });
});

describe('workflowDefinitionSchema', () => {
  const won = {
    trigger: {
      type: TriggerType.RECORD_UPDATED,
      object: 'opportunity',
      fields: ['stage'],
      when: { conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }] },
    },
    steps: [
      {
        id: 'create_task',
        name: 'Create task',
        type: StepType.CREATE_RECORD,
        object: 'task',
        values: { title: 'Kick off {{trigger.record.name}}' },
      },
      {
        id: 'big_deal',
        name: 'Big deal?',
        type: StepType.IF_ELSE,
        condition: {
          conditions: [{ left: '{{trigger.record.amount.amount}}', op: 'gte', right: '100000' }],
        },
        then: [
          {
            id: 'notify',
            name: 'Email',
            type: StepType.SEND_EMAIL,
            to: 'sales@example.com',
            subject: 'Big win: {{trigger.record.name}}',
          },
        ],
      },
    ],
  };

  it('accepts an AI step that classifies and saves its answer', () => {
    const step = {
      id: 'classify',
      name: 'Classify',
      type: StepType.AI,
      prompt: 'Is {{trigger.record.name}} a big deal?',
      choices: ['Yes', 'No'],
      output: { object: 'opportunity', recordId: '{{trigger.record.id}}', field: 'name' },
    };
    expect(workflowDefinitionSchema.parse({ ...won, steps: [step] }).steps[0]).toEqual(step);
  });

  it('accepts a valid workflow and fills defaults', () => {
    const parsed = workflowDefinitionSchema.parse(won);
    expect(flattenSteps(parsed.steps).map((s) => s.id)).toEqual([
      'create_task',
      'big_deal',
      'notify',
    ]);
    const branch = parsed.steps[1];
    expect(branch.type === StepType.IF_ELSE && branch.else).toEqual([]);
  });

  it.each([
    [{ ...won, steps: [...won.steps, { ...won.steps[0] }] }, 'Step id "create_task" is used twice'],
    [{ ...won, steps: [{ ...won.steps[0], id: 'Bad Id' }] }, 'Step ids use lowercase'],
    [{ ...won, trigger: { type: TriggerType.SCHEDULE, cron: 'every day' } }, 'cron expression'],
    [{ ...won, trigger: { type: 'WHENEVER' } }, 'trigger'],
    [{ ...won, steps: [{ id: 'x', name: 'X', type: StepType.DELAY, seconds: 0 }] }, 'seconds'],
    [{ ...won, steps: [{ id: 'x', name: 'X', type: StepType.AI, prompt: '' }] }, 'prompt'],
    [
      {
        ...won,
        steps: [{ id: 'x', name: 'X', type: StepType.AI, prompt: 'p', choices: ['Only'] }],
      },
      'choices',
    ],
    [
      {
        ...won,
        steps: [
          {
            id: 'x',
            name: 'X',
            type: StepType.AI,
            prompt: 'p',
            output: { object: 'task', field: 'body' },
          },
        ],
      },
      'output.recordId',
    ],
    [
      {
        ...won,
        steps: [
          { id: 'x', name: 'X', type: StepType.SEND_EMAIL, to: 'a@b.c', subject: 'S', sneaky: 1 },
        ],
      },
      'Unrecognized key',
    ],
  ])('rejects invalid definitions (%#)', (definition, message) => {
    const result = workflowDefinitionSchema.safeParse(definition);
    expect(result.success).toBe(false);
    expect(
      result.error!.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('\n'),
    ).toContain(message);
  });
});
