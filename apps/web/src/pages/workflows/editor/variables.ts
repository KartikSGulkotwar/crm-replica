import type {
  FieldMetadataDto,
  ObjectMetadataDto,
  WorkflowDefinition,
  WorkflowStep,
} from '@crm-replica/shared';
import { FieldType, StepType, TriggerType } from '@crm-replica/shared';

export interface VariableGroup {
  label: string;
  variables: { path: string; label: string }[];
}

const recordKey = (f: FieldMetadataDto) => (f.type === FieldType.RELATION ? `${f.name}Id` : f.name);

function recordVariables(
  prefix: string,
  object: ObjectMetadataDto | undefined,
): { path: string; label: string }[] {
  const base = [{ path: `${prefix}.id`, label: 'ID' }];
  if (!object) return base;
  return [
    ...base,
    ...object.fields.flatMap((f) =>
      f.type === FieldType.CURRENCY
        ? [
            { path: `${prefix}.${f.name}.amount`, label: `${f.label} (amount)` },
            { path: `${prefix}.${f.name}.currency`, label: `${f.label} (currency)` },
          ]
        : [{ path: `${prefix}.${recordKey(f)}`, label: f.label }],
    ),
    { path: `${prefix}.createdAt`, label: 'Created at' },
  ];
}

const findObject = (objects: ObjectMetadataDto[], name: string | undefined) =>
  objects.find((o) => o.nameSingular === name || o.namePlural === name);

function stepVariables(step: WorkflowStep, objects: ObjectMetadataDto[]): VariableGroup | null {
  const prefix = `steps.${step.id}.result`;
  switch (step.type) {
    case StepType.CREATE_RECORD:
    case StepType.UPDATE_RECORD:
      return {
        label: step.name,
        variables: recordVariables(prefix, findObject(objects, step.object)),
      };
    case StepType.FIND_RECORDS:
      return {
        label: step.name,
        variables: [
          { path: `${prefix}.count`, label: 'Number found' },
          { path: `${prefix}.totalCount`, label: 'Total matching' },
          ...recordVariables(`${prefix}.first`, findObject(objects, step.object)).map((v) => ({
            ...v,
            label: `First: ${v.label}`,
          })),
        ],
      };
    case StepType.HTTP_REQUEST:
      return {
        label: step.name,
        variables: [
          { path: `${prefix}.status`, label: 'Status code' },
          { path: `${prefix}.body`, label: 'Response body' },
        ],
      };
    case StepType.SEND_EMAIL:
      return { label: step.name, variables: [{ path: `${prefix}.delivered`, label: 'Delivered' }] };
    case StepType.AI:
      return { label: step.name, variables: [{ path: `${prefix}.answer`, label: 'AI answer' }] };
    case StepType.IF_ELSE:
      return {
        label: step.name,
        variables: [{ path: `${prefix}.matched`, label: 'Condition matched' }],
      };
    default:
      return null;
  }
}

/**
 * Variables a step can use: the trigger's record plus results of steps that run before it
 * (the same rule the server checks when publishing).
 */
export function variablesFor(
  definition: WorkflowDefinition,
  objects: ObjectMetadataDto[],
  stepId: string | null,
): VariableGroup[] {
  const trigger = definition.trigger;
  const groups: VariableGroup[] = [];
  const object = 'object' in trigger ? findObject(objects, trigger.object) : undefined;
  if (object) {
    groups.push({
      label: `Trigger: ${object.labelSingular}`,
      variables: recordVariables('trigger.record', object),
    });
    if (trigger.type === TriggerType.RECORD_UPDATED) {
      groups.push({
        label: 'Trigger: before the change',
        variables: recordVariables('trigger.before', object),
      });
    }
  }
  groups.push({
    label: 'Run',
    variables: [
      { path: 'trigger.occurredAt', label: 'When it was triggered' },
      { path: 'now', label: 'Now' },
      { path: 'run.id', label: 'Run ID' },
    ],
  });
  if (stepId === null) return groups;

  // Walk in order; stop at the step being edited. Branch steps are visible after their if/else.
  const walk = (steps: WorkflowStep[], available: WorkflowStep[]): WorkflowStep[] | null => {
    for (const step of steps) {
      if (step.id === stepId) return available;
      if (step.type === StepType.IF_ELSE) {
        const inThen = walk(step.then, [...available, step]);
        if (inThen) return inThen;
        const inElse = walk(step.else, [...available, step]);
        if (inElse) return inElse;
        available = [...available, step, ...step.then, ...step.else];
      } else {
        available = [...available, step];
      }
    }
    return null;
  };
  for (const step of walk(definition.steps, []) ?? []) {
    const group = stepVariables(step, objects);
    if (group) groups.push(group);
  }
  return groups;
}
