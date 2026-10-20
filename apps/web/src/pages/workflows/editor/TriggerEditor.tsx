import type { ObjectMetadataDto, WorkflowDefinition, WorkflowTrigger } from '@crm-replica/shared';
import { TriggerType } from '@crm-replica/shared';
import { ConditionsEditor, inputClass, Labeled, ObjectSelect } from './inputs';
import { variablesFor } from './variables';

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  [TriggerType.RECORD_CREATED]: 'A record is created',
  [TriggerType.RECORD_UPDATED]: 'A record is updated',
  [TriggerType.RECORD_DELETED]: 'A record is deleted',
  [TriggerType.MANUAL]: 'Someone runs it (button)',
  [TriggerType.SCHEDULE]: 'On a schedule',
};

const CRON_PRESETS = [
  { cron: '0 9 * * *', label: 'Every day at 09:00' },
  { cron: '0 9 * * 1', label: 'Mondays at 09:00' },
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 8 1 * *', label: 'First day of the month at 08:00' },
];

/** Describes a trigger in one line, e.g. “When an Opportunity is updated (Stage)”. */
export function describeTrigger(trigger: WorkflowTrigger, objects: ObjectMetadataDto[]): string {
  const label = (name?: string) =>
    objects.find((o) => o.nameSingular === name)?.labelSingular ?? name ?? '';
  switch (trigger.type) {
    case TriggerType.RECORD_CREATED:
      return `When a ${label(trigger.object)} is created`;
    case TriggerType.RECORD_UPDATED:
      return `When a ${label(trigger.object)} is updated${trigger.fields?.length ? ` (${trigger.fields.join(', ')})` : ''}`;
    case TriggerType.RECORD_DELETED:
      return `When a ${label(trigger.object)} is deleted`;
    case TriggerType.MANUAL:
      return trigger.object ? `Run by hand on a ${label(trigger.object)}` : 'Run by hand';
    case TriggerType.SCHEDULE:
      return `On a schedule (${CRON_PRESETS.find((p) => p.cron === trigger.cron)?.label ?? trigger.cron})`;
  }
}

export function TriggerEditor({
  definition,
  objects,
  onChange,
  readOnly,
}: {
  definition: WorkflowDefinition;
  objects: ObjectMetadataDto[];
  onChange: (t: WorkflowTrigger) => void;
  readOnly: boolean;
}) {
  const trigger = definition.trigger;
  const firstObject = objects.find((o) => !o.isSystem)?.nameSingular ?? 'company';
  const object = 'object' in trigger ? trigger.object : undefined;
  const groups = variablesFor(definition, objects, null).filter((g) =>
    g.label.startsWith('Trigger'),
  );

  function changeType(type: TriggerType) {
    if (type === TriggerType.SCHEDULE)
      return onChange({
        type,
        cron: '0 9 * * 1',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    if (type === TriggerType.MANUAL) return onChange({ type, object });
    onChange({ type, object: object ?? firstObject } as WorkflowTrigger);
  }

  const objectDef = objects.find((o) => o.nameSingular === object);

  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <Labeled label="When">
        <select
          aria-label="Trigger"
          value={trigger.type}
          onChange={(e) => changeType(e.target.value as TriggerType)}
          className={inputClass}
        >
          {Object.values(TriggerType).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
      </Labeled>

      {trigger.type !== TriggerType.SCHEDULE && (
        <ObjectSelect
          label={trigger.type === TriggerType.MANUAL ? 'On records of (optional)' : 'Object'}
          value={object}
          objects={objects}
          allowNone={trigger.type === TriggerType.MANUAL ? 'No record (run on its own)' : undefined}
          onChange={(o) => onChange({ ...trigger, object: o } as WorkflowTrigger)}
        />
      )}

      {trigger.type === TriggerType.RECORD_UPDATED && objectDef && (
        <Labeled label="Only when these fields change (none ticked = any change)">
          <div
            className="flex flex-wrap gap-x-4 gap-y-1"
            role="group"
            aria-label="Fields that trigger"
          >
            {objectDef.fields.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={trigger.fields?.includes(f.name) ?? false}
                  onChange={(e) => {
                    const fields = e.target.checked
                      ? [...(trigger.fields ?? []), f.name]
                      : (trigger.fields ?? []).filter((x) => x !== f.name);
                    onChange({ ...trigger, fields: fields.length ? fields : undefined });
                  }}
                />
                {f.label}
              </label>
            ))}
          </div>
        </Labeled>
      )}

      {'object' in trigger && trigger.type !== TriggerType.MANUAL && object && (
        <Labeled label="Only if (optional)">
          <ConditionsEditor
            value={trigger.when ?? { match: 'all', conditions: [] }}
            onChange={(when) =>
              onChange({
                ...trigger,
                when: when.conditions.length ? when : undefined,
              } as WorkflowTrigger)
            }
            groups={groups}
            emptyText="Runs for every matching record. Add a condition such as “Stage is WON”."
          />
        </Labeled>
      )}

      {trigger.type === TriggerType.SCHEDULE && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Schedule (cron)" hint="minute hour day-of-month month day-of-week">
            <input
              aria-label="Cron"
              value={trigger.cron}
              onChange={(e) => onChange({ ...trigger, cron: e.target.value })}
              className={`${inputClass} font-mono`}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => onChange({ ...trigger, cron: p.cron })}
                  className="rounded bg-raised px-1.5 py-0.5 text-xs hover:text-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Labeled>
          <Labeled label="Time zone">
            <input
              aria-label="Time zone"
              value={trigger.timezone ?? ''}
              onChange={(e) => onChange({ ...trigger, timezone: e.target.value || undefined })}
              className={inputClass}
              placeholder="UTC"
            />
          </Labeled>
        </div>
      )}
    </fieldset>
  );
}
