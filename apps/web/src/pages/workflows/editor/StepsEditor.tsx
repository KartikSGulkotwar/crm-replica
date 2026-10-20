import type {
  FilterOperator,
  ObjectMetadataDto,
  WorkflowDefinition,
  WorkflowStep,
} from '@crm-replica/shared';
import { FIELD_TYPE_INFO, flattenSteps, StepType } from '@crm-replica/shared';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Filter,
  GitBranch,
  Globe,
  Mail,
  PencilLine,
  Plus,
  SquarePlus,
  Trash2,
  X,
} from 'lucide-react';
import { ReactNode, useRef, useState } from 'react';
import { Popover } from '../../../components/Popover';
import {
  ConditionsEditor,
  inputClass,
  Labeled,
  ObjectSelect,
  TemplateInput,
  ValuesEditor,
} from './inputs';
import { variablesFor, VariableGroup } from './variables';

export const STEP_TYPES: { type: StepType; label: string; description: string; icon: ReactNode }[] =
  [
    {
      type: StepType.CREATE_RECORD,
      label: 'Create record',
      description: 'Add a record to any object',
      icon: <SquarePlus aria-hidden className="size-4" />,
    },
    {
      type: StepType.UPDATE_RECORD,
      label: 'Update record',
      description: 'Change fields of a record',
      icon: <PencilLine aria-hidden className="size-4" />,
    },
    {
      type: StepType.FIND_RECORDS,
      label: 'Find records',
      description: 'Look up records to use later',
      icon: <Filter aria-hidden className="size-4" />,
    },
    {
      type: StepType.SEND_EMAIL,
      label: 'Send email',
      description: 'Email someone',
      icon: <Mail aria-hidden className="size-4" />,
    },
    {
      type: StepType.HTTP_REQUEST,
      label: 'HTTP request',
      description: 'Call a webhook or API',
      icon: <Globe aria-hidden className="size-4" />,
    },
    {
      type: StepType.DELAY,
      label: 'Wait',
      description: 'Pause before the next step',
      icon: <Clock aria-hidden className="size-4" />,
    },
    {
      type: StepType.IF_ELSE,
      label: 'If / else',
      description: 'Branch on a condition',
      icon: <GitBranch aria-hidden className="size-4" />,
    },
  ];

const stepMeta = (type: StepType) => STEP_TYPES.find((s) => s.type === type)!;

/** A new step with sensible defaults and an id not used elsewhere in the workflow. */
function newStep(type: StepType, definition: WorkflowDefinition): WorkflowStep {
  const taken = new Set(flattenSteps(definition.steps).map((s) => s.id));
  const base = type.toLowerCase();
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  const name = stepMeta(type).label;
  const object =
    'object' in definition.trigger && definition.trigger.object
      ? definition.trigger.object
      : 'task';
  switch (type) {
    case StepType.CREATE_RECORD:
      return { id, name, type, object: 'task', values: {} };
    case StepType.UPDATE_RECORD:
      return { id, name, type, object, recordId: '{{trigger.record.id}}', values: {} };
    case StepType.FIND_RECORDS:
      return { id, name, type, object: 'company', limit: 10 };
    case StepType.SEND_EMAIL:
      return { id, name, type, to: '', subject: '', body: '' };
    case StepType.HTTP_REQUEST:
      return {
        id,
        name,
        type,
        method: 'POST',
        url: 'https://',
        headers: {},
        body: { record: '{{trigger.record}}' },
      };
    case StepType.DELAY:
      return { id, name, type, seconds: 3600 };
    case StepType.IF_ELSE:
      return {
        id,
        name,
        type,
        condition: { match: 'all', conditions: [{ left: '', op: 'eq', right: '' }] },
        then: [],
        else: [],
      };
    default:
      throw new Error(`Unknown step type ${type}`);
  }
}

function AddStepButton({
  onAdd,
  label = 'Add step',
}: {
  onAdd: (type: StepType) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-sm text-accent hover:bg-raised"
      >
        <Plus aria-hidden className="size-4" /> {label}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={260}>
          <ul role="menu" aria-label="Step types">
            {STEP_TYPES.map((s) => (
              <li key={s.type}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAdd(s.type);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-raised"
                >
                  <span className="mt-0.5 text-muted">{s.icon}</span>
                  <span>
                    <span className="block font-medium">{s.label}</span>
                    <span className="block text-xs text-muted">{s.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}

const DELAY_UNITS = [
  { label: 'minutes', seconds: 60 },
  { label: 'hours', seconds: 3600 },
  { label: 'days', seconds: 86400 },
  { label: 'seconds', seconds: 1 },
];

interface FindCondition {
  field: string;
  op: string;
  value?: unknown;
}

/** FIND_RECORDS filter as simple rows (all must match). */
function FindFilterEditor({
  object,
  filter,
  onChange,
  groups,
}: {
  object: ObjectMetadataDto | undefined;
  filter: unknown;
  onChange: (f: unknown) => void;
  groups: VariableGroup[];
}) {
  if (!object) return null;
  const rows: FindCondition[] = !filter
    ? []
    : 'and' in (filter as object)
      ? (filter as { and: FindCondition[] }).and
      : [filter as FindCondition];
  const save = (next: FindCondition[]) =>
    onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : { and: next });
  const fields = [...object.fields, { name: 'id', label: 'ID', type: 'RELATION' } as never];
  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted">
          No filter: finds any {object.labelPlural.toLowerCase()}.
        </p>
      )}
      {rows.map((row, i) => {
        const field = fields.find((f: { name: string }) => f.name === row.field) as
          { name: string; label: string; type: keyof typeof FIELD_TYPE_INFO } | undefined;
        const ops: FilterOperator[] = field ? FIELD_TYPE_INFO[field.type].operators : ['eq'];
        const set = (patch: Partial<FindCondition>) =>
          save(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
        return (
          <div
            key={i}
            className="grid gap-1.5 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_auto]"
            data-testid="find-condition"
          >
            <select
              aria-label={`Filter ${i + 1} field`}
              value={row.field}
              onChange={(e) => set({ field: e.target.value })}
              className={inputClass}
            >
              {fields.map((f: { name: string; label: string }) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label={`Filter ${i + 1} operator`}
              value={row.op}
              onChange={(e) => set({ op: e.target.value })}
              className={inputClass}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {row.op === 'isEmpty' || row.op === 'isNotEmpty' ? (
              <span />
            ) : (
              <TemplateInput
                label={`Filter ${i + 1} value`}
                value={String(row.value ?? '')}
                onChange={(value) => set({ value })}
                groups={groups}
              />
            )}
            <button
              type="button"
              aria-label={`Remove filter ${i + 1}`}
              onClick={() => save(rows.filter((_, j) => j !== i))}
              className="rounded p-1.5 text-muted hover:bg-raised hover:text-bad"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          save([...rows, { field: object.labelIdentifierFieldName ?? 'id', op: 'eq', value: '' }])
        }
        className="flex items-center gap-1 text-sm text-accent hover:underline"
      >
        <Plus aria-hidden className="size-4" /> Add filter
      </button>
    </div>
  );
}

function StepForm({
  step,
  onChange,
  definition,
  objects,
}: {
  step: WorkflowStep;
  onChange: (s: WorkflowStep) => void;
  definition: WorkflowDefinition;
  objects: ObjectMetadataDto[];
}) {
  const groups = variablesFor(definition, objects, step.id);
  const objectOf = (name: string) =>
    objects.find((o) => o.nameSingular === name || o.namePlural === name);
  switch (step.type) {
    case StepType.CREATE_RECORD:
    case StepType.UPDATE_RECORD:
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ObjectSelect
              value={step.object}
              objects={objects}
              onChange={(object) =>
                onChange({ ...step, object: object ?? step.object, values: {} })
              }
            />
            {step.type === StepType.UPDATE_RECORD && (
              <Labeled label="Record to update (id)">
                <TemplateInput
                  label="Record id"
                  value={step.recordId}
                  onChange={(recordId) => onChange({ ...step, recordId })}
                  groups={groups}
                />
              </Labeled>
            )}
          </div>
          <Labeled label="Fields">
            <ValuesEditor
              object={objectOf(step.object)}
              value={step.values}
              onChange={(values) => onChange({ ...step, values })}
              groups={groups}
            />
          </Labeled>
        </div>
      );
    case StepType.FIND_RECORDS:
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ObjectSelect
              value={step.object}
              objects={objects}
              onChange={(object) =>
                onChange({ ...step, object: object ?? step.object, filter: undefined })
              }
            />
            <Labeled label="At most">
              <input
                aria-label="Limit"
                type="number"
                min={1}
                max={100}
                value={step.limit}
                onChange={(e) =>
                  onChange({
                    ...step,
                    limit: Math.min(100, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
                className={inputClass}
              />
            </Labeled>
          </div>
          <Labeled label="Where">
            <FindFilterEditor
              object={objectOf(step.object)}
              filter={step.filter}
              onChange={(filter) => onChange({ ...step, filter })}
              groups={groups}
            />
          </Labeled>
        </div>
      );
    case StepType.SEND_EMAIL:
      return (
        <div className="space-y-3">
          <Labeled label="To" hint="One or more addresses, separated by commas.">
            <TemplateInput
              label="To"
              value={step.to}
              onChange={(to) => onChange({ ...step, to })}
              groups={groups}
              placeholder="sales@example.com"
            />
          </Labeled>
          <Labeled label="Subject">
            <TemplateInput
              label="Subject"
              value={step.subject}
              onChange={(subject) => onChange({ ...step, subject })}
              groups={groups}
            />
          </Labeled>
          <Labeled label="Message">
            <TemplateInput
              label="Message"
              value={step.body}
              onChange={(body) => onChange({ ...step, body })}
              groups={groups}
              multiline
            />
          </Labeled>
        </div>
      );
    case StepType.HTTP_REQUEST: {
      return <HttpForm step={step} onChange={onChange} groups={groups} />;
    }
    case StepType.DELAY: {
      const unit =
        [...DELAY_UNITS].find((u) => step.seconds % u.seconds === 0 && u.seconds > 1) ??
        DELAY_UNITS[3];
      return (
        <div className="flex items-end gap-2">
          <Labeled label="Wait for">
            <input
              aria-label="Wait amount"
              type="number"
              min={1}
              value={step.seconds / unit.seconds}
              onChange={(e) =>
                onChange({
                  ...step,
                  seconds: Math.max(1, Math.round(Number(e.target.value) || 1) * unit.seconds),
                })
              }
              className={`${inputClass} w-24`}
            />
          </Labeled>
          <select
            aria-label="Wait unit"
            value={unit.seconds}
            onChange={(e) =>
              onChange({
                ...step,
                seconds:
                  Math.max(1, Math.round(step.seconds / unit.seconds)) * Number(e.target.value),
              })
            }
            className={`${inputClass} w-auto`}
          >
            {DELAY_UNITS.map((u) => (
              <option key={u.label} value={u.seconds}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case StepType.IF_ELSE:
      return (
        <Labeled label="If">
          <ConditionsEditor
            value={step.condition}
            onChange={(condition) => onChange({ ...step, condition })}
            groups={groups}
            emptyText="Add a condition."
          />
        </Labeled>
      );
  }
}

function HttpForm({
  step,
  onChange,
  groups,
}: {
  step: Extract<WorkflowStep, { type: StepType.HTTP_REQUEST }>;
  onChange: (s: WorkflowStep) => void;
  groups: VariableGroup[];
}) {
  const [bodyText, setBodyText] = useState(
    step.body === undefined ? '' : JSON.stringify(step.body, null, 2),
  );
  const [bodyError, setBodyError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <Labeled label="Method">
          <select
            aria-label="Method"
            value={step.method}
            onChange={(e) => onChange({ ...step, method: e.target.value as typeof step.method })}
            className={inputClass}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="URL">
          <TemplateInput
            label="URL"
            value={step.url}
            onChange={(url) => onChange({ ...step, url })}
            groups={groups}
          />
        </Labeled>
      </div>
      {step.method !== 'GET' && (
        <Labeled
          label="JSON body"
          hint={
            bodyError ?? 'Strings may use variables; "{{trigger.record}}" sends the whole record.'
          }
        >
          <TemplateInput
            label="JSON body"
            multiline
            value={bodyText}
            groups={groups}
            onChange={(text) => {
              setBodyText(text);
              if (!text.trim()) {
                setBodyError(null);
                return onChange({ ...step, body: undefined });
              }
              try {
                onChange({ ...step, body: JSON.parse(text) });
                setBodyError(null);
              } catch {
                setBodyError('Not valid JSON yet; the last valid body is kept.');
              }
            }}
          />
        </Labeled>
      )}
    </div>
  );
}

/** The vertical list of steps (used for the workflow and for each if/else branch). */
export function StepList({
  steps,
  onChange,
  definition,
  objects,
  readOnly,
  problems,
}: {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
  definition: WorkflowDefinition;
  objects: ObjectMetadataDto[];
  readOnly: boolean;
  problems: string[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const set = (i: number, s: WorkflowStep) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const open = expanded === step.id;
        const stepProblems = problems.filter((p) => p.startsWith(`${step.name}:`));
        return (
          <li
            key={step.id}
            className="rounded-lg border border-line bg-surface"
            data-testid={`step-${step.id}`}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                {stepMeta(step.type).icon}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : step.id)}
                aria-expanded={open}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium">{step.name}</span>
                <span className="block truncate text-xs text-muted">
                  {stepMeta(step.type).label} · <code className="font-mono">{step.id}</code>
                </span>
              </button>
              {stepProblems.length > 0 && (
                <span className="rounded bg-bad/10 px-1.5 text-xs text-bad">
                  {stepProblems.length} problem{stepProblems.length > 1 ? 's' : ''}
                </span>
              )}
              {!readOnly && (
                <div className="flex shrink-0">
                  <button
                    type="button"
                    aria-label={`Move ${step.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded p-1 text-muted hover:bg-raised disabled:opacity-30"
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${step.name} down`}
                    disabled={i === steps.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded p-1 text-muted hover:bg-raised disabled:opacity-30"
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${step.name}`}
                    onClick={() => onChange(steps.filter((_, j) => j !== i))}
                    className="rounded p-1 text-muted hover:bg-raised hover:text-bad"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              )}
            </div>
            {open && (
              <fieldset disabled={readOnly} className="space-y-3 border-t border-line p-3">
                <Labeled label="Step name">
                  <input
                    aria-label="Step name"
                    value={step.name}
                    onChange={(e) => set(i, { ...step, name: e.target.value })}
                    className={inputClass}
                  />
                </Labeled>
                <StepForm
                  step={step}
                  onChange={(s) => set(i, s)}
                  definition={definition}
                  objects={objects}
                />
                {stepProblems.map((p) => (
                  <p key={p} className="text-xs text-bad">
                    {p.slice(step.name.length + 2)}
                  </p>
                ))}
              </fieldset>
            )}
            {step.type === StepType.IF_ELSE && (
              <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
                {(['then', 'else'] as const).map((branch) => (
                  <div key={branch} className="rounded-md bg-raised/60 p-2">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                      {branch === 'then' ? 'Then' : 'Otherwise'}
                    </div>
                    <StepList
                      steps={step[branch]}
                      onChange={(next) => set(i, { ...step, [branch]: next })}
                      definition={definition}
                      objects={objects}
                      readOnly={readOnly}
                      problems={problems}
                    />
                    {!readOnly && (
                      <AddStepButton
                        label="Add step"
                        onAdd={(type) =>
                          set(i, {
                            ...step,
                            [branch]: [...step[branch], newStep(type, definition)],
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
      {steps.length === 0 && <li className="text-xs text-muted">No steps yet.</li>}
    </ol>
  );
}

export function StepsEditor({
  definition,
  objects,
  onChange,
  readOnly,
  problems,
}: {
  definition: WorkflowDefinition;
  objects: ObjectMetadataDto[];
  onChange: (steps: WorkflowStep[]) => void;
  readOnly: boolean;
  problems: string[];
}) {
  return (
    <div className="space-y-2">
      <StepList
        steps={definition.steps}
        onChange={onChange}
        definition={definition}
        objects={objects}
        readOnly={readOnly}
        problems={problems}
      />
      {!readOnly && (
        <AddStepButton
          onAdd={(type) => onChange([...definition.steps, newStep(type, definition)])}
        />
      )}
    </div>
  );
}
