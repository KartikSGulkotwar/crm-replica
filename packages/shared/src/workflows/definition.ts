import { z } from 'zod';
import { apiNameSchema } from '../metadata/schemas';

/** Step ids are how later steps refer to results: `{{steps.find_company.result.id}}`. */
export const stepIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,40}$/,
    'Step ids use lowercase letters, digits and _ (e.g. find_company)',
  );

/** A string that may contain `{{variables}}`. */
const template = z.string().max(10_000);

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
  'isEmpty',
  'isNotEmpty',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** `{{trigger.record.stage}} eq WON`. Both sides may use variables. */
export const conditionSchema = z
  .object({
    left: template,
    op: z.enum(CONDITION_OPERATORS),
    right: template.optional(),
  })
  .strict();

export const conditionGroupSchema = z
  .object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(conditionSchema).max(20).default([]),
  })
  .strict();

export type Condition = z.infer<typeof conditionSchema>;
export type ConditionGroup = z.output<typeof conditionGroupSchema>;

export enum TriggerType {
  RECORD_CREATED = 'RECORD_CREATED',
  RECORD_UPDATED = 'RECORD_UPDATED',
  RECORD_DELETED = 'RECORD_DELETED',
  MANUAL = 'MANUAL',
  SCHEDULE = 'SCHEDULE',
}

const recordTrigger = <T extends TriggerType>(type: T) =>
  z
    .object({
      type: z.literal(type),
      /** nameSingular of the object, e.g. `opportunity`. */
      object: apiNameSchema,
      /** Run only when these conditions hold for the record. */
      when: conditionGroupSchema.optional(),
    })
    .strict();

export const triggerSchema = z.discriminatedUnion('type', [
  recordTrigger(TriggerType.RECORD_CREATED),
  recordTrigger(TriggerType.RECORD_UPDATED).extend({
    /** Only run when one of these fields changed (empty = any change). */
    fields: z.array(apiNameSchema).max(50).optional(),
  }),
  recordTrigger(TriggerType.RECORD_DELETED),
  z
    .object({
      type: z.literal(TriggerType.MANUAL),
      /** Shows a "Run" button on records of this object. Without one, it runs with no record. */
      object: apiNameSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal(TriggerType.SCHEDULE),
      /** Cron expression, e.g. `0 9 * * 1` (Mondays 09:00). */
      cron: z
        .string()
        .regex(/^\S+(\s+\S+){4,5}$/, 'Use a cron expression with 5 parts, e.g. "0 9 * * 1"'),
      timezone: z.string().max(60).optional(),
    })
    .strict(),
]);

export type WorkflowTrigger = z.infer<typeof triggerSchema>;

export enum StepType {
  CREATE_RECORD = 'CREATE_RECORD',
  UPDATE_RECORD = 'UPDATE_RECORD',
  FIND_RECORDS = 'FIND_RECORDS',
  SEND_EMAIL = 'SEND_EMAIL',
  HTTP_REQUEST = 'HTTP_REQUEST',
  DELAY = 'DELAY',
  IF_ELSE = 'IF_ELSE',
}

/** Field values for record steps; strings may use variables (a lone `{{x}}` keeps its type). */
const valuesSchema = z.record(apiNameSchema, z.unknown());

const base = { id: stepIdSchema, name: z.string().trim().min(1).max(80) };

const createRecordStep = z
  .object({
    ...base,
    type: z.literal(StepType.CREATE_RECORD),
    object: apiNameSchema,
    values: valuesSchema.default({}),
  })
  .strict();
const updateRecordStep = z
  .object({
    ...base,
    type: z.literal(StepType.UPDATE_RECORD),
    object: apiNameSchema,
    recordId: template.min(1),
    values: valuesSchema.default({}),
  })
  .strict();
const findRecordsStep = z
  .object({
    ...base,
    type: z.literal(StepType.FIND_RECORDS),
    object: apiNameSchema,
    /** Records-API filter tree; values may use variables. */
    filter: z.unknown().optional(),
    sort: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(10),
  })
  .strict();
const sendEmailStep = z
  .object({
    ...base,
    type: z.literal(StepType.SEND_EMAIL),
    to: template.min(1),
    subject: template.min(1),
    body: template.default(''),
  })
  .strict();
const httpStep = z
  .object({
    ...base,
    type: z.literal(StepType.HTTP_REQUEST),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    url: template.min(1),
    headers: z.record(z.string().max(100), template).default({}),
    /** JSON body; strings may use variables. */
    body: z.unknown().optional(),
  })
  .strict();
const delayStep = z
  .object({
    ...base,
    type: z.literal(StepType.DELAY),
    /** How long to wait before the next step (up to 30 days). */
    seconds: z
      .number()
      .int()
      .min(1)
      .max(30 * 24 * 3600),
  })
  .strict();
export type WorkflowStep =
  | z.output<typeof createRecordStep>
  | z.output<typeof updateRecordStep>
  | z.output<typeof findRecordsStep>
  | z.output<typeof sendEmailStep>
  | z.output<typeof httpStep>
  | z.output<typeof delayStep>
  | IfElseStep;

/** What an author may write (defaults such as `values: {}` or `limit` can be left out). */
export type WorkflowStepInput =
  | z.input<typeof createRecordStep>
  | z.input<typeof updateRecordStep>
  | z.input<typeof findRecordsStep>
  | z.input<typeof sendEmailStep>
  | z.input<typeof httpStep>
  | z.input<typeof delayStep>
  | {
      id: string;
      name: string;
      type: StepType.IF_ELSE;
      condition: z.input<typeof conditionGroupSchema>;
      then?: WorkflowStepInput[];
      else?: WorkflowStepInput[];
    };

export interface IfElseStep {
  id: string;
  name: string;
  type: StepType.IF_ELSE;
  condition: ConditionGroup;
  then: WorkflowStep[];
  else: WorkflowStep[];
}

export const stepSchema: z.ZodType<WorkflowStep, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    createRecordStep,
    updateRecordStep,
    findRecordsStep,
    sendEmailStep,
    httpStep,
    delayStep,
    z
      .object({
        ...base,
        type: z.literal(StepType.IF_ELSE),
        condition: conditionGroupSchema,
        then: z.array(stepSchema).max(50).default([]),
        else: z.array(stepSchema).max(50).default([]),
      })
      .strict(),
  ]),
) as never;

/** Every step, including those inside if/else branches, in definition order. */
export function flattenSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.flatMap((s) =>
    s.type === StepType.IF_ELSE ? [s, ...flattenSteps(s.then), ...flattenSteps(s.else)] : [s],
  );
}

export const workflowDefinitionSchema = z
  .object({
    trigger: triggerSchema,
    steps: z.array(stepSchema).max(50).default([]),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = flattenSteps(d.steps).map((s) => s.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: `Step id "${dup}" is used twice` });
    if (ids.length > 100)
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'A workflow can have at most 100 steps',
      });
  });

export type WorkflowDefinition = z.output<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = {
  trigger: z.input<typeof triggerSchema>;
  steps?: WorkflowStepInput[];
};

export const createWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullish(),
    definition: workflowDefinitionSchema.optional(),
  })
  .strict();

export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullish(),
  })
  .strict();

export const saveDraftSchema = z.object({ definition: workflowDefinitionSchema }).strict();

export const runWorkflowSchema = z.object({ recordId: z.string().uuid().optional() }).strict();
