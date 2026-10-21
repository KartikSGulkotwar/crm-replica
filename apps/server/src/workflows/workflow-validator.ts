import {
  collectVariables,
  FieldType,
  StepType,
  TriggerType,
  WorkflowDefinition,
  WorkflowStep,
} from '@crm-replica/shared';
import { parseExpression } from 'cron-parser';
import { ObjectModel, WorkspaceModel } from '../records/object-model';

const ROOTS = ['trigger', 'steps', 'run', 'now'];

/** Next time a cron expression fires (or null if it's invalid). */
export function nextCronRun(cron: string, timezone?: string): Date | null {
  try {
    return parseExpression(cron, { tz: timezone }).next().toDate();
  } catch {
    return null;
  }
}

/**
 * Checks a definition against the workspace's data model. Returns human-readable problems;
 * a draft can be saved with problems, but it can't be published or test-run until they're fixed.
 */
export function validateWorkflow(definition: WorkflowDefinition, model: WorkspaceModel): string[] {
  const problems: string[] = [];
  const findObject = (name: string): ObjectModel | undefined =>
    model.objects.find((o) => !o.isSystem && (o.nameSingular === name || o.namePlural === name));

  const trigger = definition.trigger;
  let triggerObject: ObjectModel | undefined;
  if ('object' in trigger && trigger.object) {
    triggerObject = findObject(trigger.object);
    if (!triggerObject) problems.push(`Trigger: object "${trigger.object}" doesn’t exist`);
  }
  if (trigger.type === TriggerType.RECORD_UPDATED && triggerObject) {
    for (const f of trigger.fields ?? []) {
      if (!triggerObject.fields.some((x) => x.name === f || x.apiKey === f))
        problems.push(`Trigger: ${triggerObject.labelSingular} has no field "${f}"`);
    }
  }
  if (trigger.type === TriggerType.SCHEDULE && !nextCronRun(trigger.cron, trigger.timezone)) {
    problems.push(
      `Trigger: "${trigger.cron}"${trigger.timezone ? ` (${trigger.timezone})` : ''} isn’t a valid schedule`,
    );
  }
  const triggerVars = 'when' in trigger && trigger.when ? collectVariables(trigger.when) : [];
  for (const v of triggerVars)
    if (!v.startsWith('trigger.'))
      problems.push(`Trigger conditions can only use {{trigger.…}} (found {{${v}}})`);

  const checkVariables = (step: WorkflowStep, value: unknown, available: Set<string>) => {
    for (const v of collectVariables(value)) {
      const [root, id] = v.split('.');
      if (!ROOTS.includes(root)) problems.push(`${step.name}: unknown variable {{${v}}}`);
      else if (root === 'steps' && !available.has(id))
        problems.push(`${step.name}: {{${v}}} refers to a step that doesn’t run before this one`);
      else if (
        root === 'trigger' &&
        !('object' in trigger && trigger.object) &&
        v.startsWith('trigger.record')
      ) {
        problems.push(`${step.name}: this trigger has no record, so {{${v}}} is always empty`);
      }
    }
  };

  const checkSteps = (steps: WorkflowStep[], available: Set<string>) => {
    for (const step of steps) {
      if (step.type === StepType.IF_ELSE) {
        checkVariables(step, step.condition, available);
        checkSteps(step.then, new Set(available));
        checkSteps(step.else, new Set(available));
        // Later steps may use results from either branch (empty if that branch didn't run).
        available.add(step.id);
        for (const s of [...step.then, ...step.else]) available.add(s.id);
        continue;
      }
      if (
        step.type === StepType.CREATE_RECORD ||
        step.type === StepType.UPDATE_RECORD ||
        step.type === StepType.FIND_RECORDS
      ) {
        const object = findObject(step.object);
        if (!object) problems.push(`${step.name}: object "${step.object}" doesn’t exist`);
        if (object && step.type !== StepType.FIND_RECORDS) {
          for (const key of Object.keys(step.values)) {
            if (key !== 'position' && !object.fields.some((f) => f.apiKey === key)) {
              const relation = object.fields.find((f) => f.name === key && f.apiKey !== key);
              problems.push(
                `${step.name}: ${relation ? `use "${relation.apiKey}" to set ${relation.label}` : `${object.labelSingular} has no field "${key}"`}`,
              );
            }
          }
        }
      }
      if (step.type === StepType.AI && step.output) {
        const object = findObject(step.output.object);
        const field = object?.fields.find((f) => f.name === step.output!.field && !f.system);
        if (!object) problems.push(`${step.name}: object "${step.output.object}" doesn’t exist`);
        else if (!field || (field.type !== FieldType.TEXT && field.type !== FieldType.SELECT))
          problems.push(
            `${step.name}: ${object.labelSingular} has no text or select field "${step.output.field}"`,
          );
        else if (field.type === FieldType.SELECT) {
          const values = (field.options ?? []).map((o) => o.value);
          const unknown = (step.choices ?? []).filter((c) => !values.includes(c));
          if (unknown.length)
            problems.push(
              `${step.name}: ${field.label} has no option ${unknown.map((c) => `"${c}"`).join(', ')}`,
            );
        }
      }
      checkVariables(step, { ...step, id: undefined, name: undefined }, available);
      available.add(step.id);
    }
  };
  checkSteps(definition.steps, new Set());
  if (definition.steps.length === 0) problems.push('Add at least one step');
  return problems;
}
