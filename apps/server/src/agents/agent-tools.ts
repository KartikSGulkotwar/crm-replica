import { HttpException, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AgentRecordRef,
  FIELD_TYPE_INFO,
  FieldType,
  ProposedAction,
  ProposedChange,
  RecordDto,
} from '@crm-replica/shared';
import { z } from 'zod';
import { ObjectModel, WorkspaceModel } from '../records/object-model';
import { ActivitiesService } from '../records/activities.service';
import { isActivityObject } from '../records/activity-targets';
import { recordRef, recordTitle } from '../records/record-ref';
import { RecordContext, RecordsService } from '../records/records.service';
import { WorkspaceModelService } from '../records/workspace-model.service';

/** Tools that change data: they're proposed to the user and only run after approval. */
export const WRITE_TOOLS = new Set(['create_record', 'update_record']);

const MAX_TEXT = 400;
const SEARCH_LIMIT = 50;

const inputs = {
  list_objects: z.object({}).strict(),
  describe_object: z.object({ object: z.string() }).strict(),
  search_records: z
    .object({
      object: z.string(),
      filter: z.unknown().optional(),
      sort: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(SEARCH_LIMIT).optional(),
    })
    .strict(),
  get_record: z
    .object({ object: z.string(), id: z.string(), include_related: z.boolean().optional() })
    .strict(),
  create_record: z.object({ object: z.string(), data: z.record(z.string(), z.unknown()) }).strict(),
  update_record: z
    .object({ object: z.string(), id: z.string(), data: z.record(z.string(), z.unknown()) })
    .strict(),
};
export type ToolName = keyof typeof inputs;

/** What running a tool returns: text for the model, plus the records it touched (for links). */
export interface ToolOutcome {
  content: string;
  isError?: boolean;
  records: AgentRecordRef[];
}

export class ToolInputError extends Error {}

/** A record trimmed for the model: no empty values, long text shortened, plus title and link. */
function compact(
  object: ObjectModel,
  record: RecordDto,
  model: WorkspaceModel,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: record.id,
    title: recordTitle(object, record),
    url: recordRef(object, record).url,
  };
  for (const field of object.fields) {
    const value = record[field.apiKey];
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
      continue;
    out[field.apiKey] =
      typeof value === 'string' && value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
    const linked = record[field.name] as RecordDto | null | undefined;
    const target = field.relationTarget
      ? model.objects.find((o) => o.nameSingular === field.relationTarget)
      : undefined;
    if (target && linked && typeof linked === 'object')
      out[field.name] = { id: linked.id, title: recordTitle(target, linked) };
  }
  out.createdAt = record.createdAt;
  return out;
}

/** Tool definitions, generated from the workspace's data model (object names are an enum). */
export function buildTools(model: WorkspaceModel): Anthropic.Beta.BetaTool[] {
  const objects = model.objects.filter((o) => !o.isSystem).map((o) => o.nameSingular);
  const readable = model.objects.map((o) => o.nameSingular);
  const objectParam = (names: string[]) => ({
    type: 'string',
    enum: names,
    description: 'The object’s singular API name (see list_objects).',
  });
  const tool = (
    name: ToolName,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
  ): Anthropic.Beta.BetaTool => ({
    name,
    description,
    // Stream large inputs as they're generated; every input is validated with zod before use.
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    } as Anthropic.Beta.BetaTool.InputSchema,
  });
  return [
    tool(
      'list_objects',
      'List the record types (objects) in this CRM with their names and descriptions.',
      {},
      [],
    ),
    tool(
      'describe_object',
      'Describe an object’s fields: names, types, select options and the filter operators each field supports. Call this before filtering or writing an object you haven’t described yet.',
      { object: objectParam(readable) },
      ['object'],
    ),
    tool(
      'search_records',
      [
        'Search records of an object. Returns matching records (each with a title and an in-app url) and the total count.',
        'filter is a JSON tree: {"field":"name","op":"contains","value":"acme"}; combine with {"and":[…]}, {"or":[…]}, {"not":{…}}.',
        'Operators depend on the field type (see describe_object). Currency fields compare their amount: {"field":"amount","op":"gte","value":50000}.',
        'Dates use "YYYY-MM-DD". Relations filter by id: {"field":"company","op":"eq","value":"<uuid>"}.',
        'sort is "field:asc" or "field:desc", comma-separated.',
      ].join(' '),
      {
        object: objectParam(readable),
        filter: { type: 'object', description: 'Optional JSON filter tree.' },
        sort: { type: 'string', description: 'e.g. "closeDate:asc".' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: SEARCH_LIMIT,
          description: `Max records to return (default 20, max ${SEARCH_LIMIT}).`,
        },
      },
      ['object'],
    ),
    tool(
      'get_record',
      'Get one record by id with all its fields and linked records. Set include_related to also list records that link to it (e.g. a company’s people and opportunities).',
      {
        object: objectParam(readable),
        id: { type: 'string' },
        include_related: { type: 'boolean' },
      },
      ['object', 'id'],
    ),
    tool(
      'create_record',
      'Propose creating a record. The user must approve it before it is created. data maps field keys to values (relations use "<name>Id", currency is {"amount":1000,"currency":"USD"}, selects use option values).',
      { object: objectParam(objects), data: { type: 'object' } },
      ['object', 'data'],
    ),
    tool(
      'update_record',
      'Propose changing fields of a record. The user must approve it before it is changed. data contains only the fields to change.',
      { object: objectParam(objects), id: { type: 'string' }, data: { type: 'object' } },
      ['object', 'id', 'data'],
    ),
  ];
}

function errorText(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    const message = typeof response === 'string' ? response : response.message;
    return Array.isArray(message) ? message.join('; ') : String(message ?? error.message);
  }
  return (error as Error).message;
}

/**
 * Runs the assistant's tools as the signed-in user: same workspace, same permissions, and
 * changes go through the normal records service (validation, events, workflows).
 */
@Injectable()
export class AgentToolExecutor {
  constructor(
    private readonly records: RecordsService,
    private readonly models: WorkspaceModelService,
    private readonly activities: ActivitiesService,
  ) {}

  /** Validates input; throws ToolInputError for bad input (reported back to the model). */
  parse<N extends ToolName>(name: N, input: unknown): z.infer<(typeof inputs)[N]> {
    const schema = inputs[name];
    if (!schema) throw new ToolInputError(`Unknown tool "${name}"`);
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new ToolInputError(
        `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`,
      );
    return parsed.data as z.infer<(typeof inputs)[N]>;
  }

  private object(model: WorkspaceModel, name: string): ObjectModel {
    const object = model.objects.find((o) => o.nameSingular === name || o.namePlural === name);
    if (!object) throw new ToolInputError(`No object called "${name}". Use list_objects.`);
    return object;
  }

  /** Read-only tools. */
  async runRead(ctx: RecordContext, name: ToolName, input: unknown): Promise<ToolOutcome> {
    try {
      const model = await this.models.load(ctx.workspace);
      switch (name) {
        case 'list_objects': {
          this.parse(name, input);
          const list = model.objects.map((o) => ({
            name: o.nameSingular,
            label: o.labelPlural,
            readOnly: o.isSystem || undefined,
            fields: o.fields.length,
          }));
          return { content: JSON.stringify(list), records: [] };
        }
        case 'describe_object': {
          const object = this.object(model, this.parse(name, input).object);
          const fields = object.fields.map((f) => ({
            key: f.apiKey,
            label: f.label,
            type: f.type,
            required: f.isRequired || undefined,
            options: f.options?.map((o) => `${o.value} (${o.label})`),
            linksTo: f.relationTarget,
            filterOperators: FIELD_TYPE_INFO[f.type].operators,
          }));
          const related = object.inverseRelations.map((r) => ({
            name: r.name,
            from: r.sourceObject,
          }));
          return {
            content: JSON.stringify({
              object: object.nameSingular,
              label: object.labelSingular,
              titleField: object.labelIdentifierFieldName,
              fields,
              related,
              builtIn: ['id', 'createdAt', 'updatedAt'],
              ...(isActivityObject(object)
                ? {
                    linking: `To link a new ${object.labelSingular.toLowerCase()} to records (e.g. a company or deal), add "targets": [{"object": "company", "id": "<record id>"}] to create_record data.`,
                  }
                : {}),
            }),
            records: [],
          };
        }
        case 'search_records': {
          const args = this.parse(name, input);
          const object = this.object(model, args.object);
          const relations = object.fields
            .filter((f) => f.type === FieldType.RELATION)
            .slice(0, 5)
            .map((f) => f.name);
          const page = await this.records.list(ctx, object.namePlural, {
            filter: args.filter === undefined ? undefined : JSON.stringify(args.filter),
            sort: args.sort,
            limit: String(args.limit ?? 20),
            expand: relations.length ? relations.join(',') : undefined,
          });
          return {
            content: JSON.stringify({
              totalCount: page.totalCount,
              returned: page.data.length,
              records: page.data.map((r) => compact(object, r, model)),
            }),
            records: page.data.map((r) => recordRef(object, r)),
          };
        }
        case 'get_record': {
          const args = this.parse(name, input);
          const object = this.object(model, args.object);
          const relations = object.fields
            .filter((f) => f.type === FieldType.RELATION)
            .map((f) => f.name);
          const inverse = args.include_related ? object.inverseRelations.map((r) => r.name) : [];
          const expand = [...relations, ...inverse].slice(0, 5);
          const record = await this.records.get(
            ctx,
            object.namePlural,
            args.id,
            expand.length ? expand.join(',') : undefined,
          );
          const out = compact(object, record, model);
          const refs = [recordRef(object, record)];
          for (const rel of object.inverseRelations.filter((r) => expand.includes(r.name))) {
            const source = model.objects.find((o) => o.nameSingular === rel.sourceObject)!;
            const list = (record[rel.name] as RecordDto[] | undefined) ?? [];
            out[rel.name] = list.map((r) => compact(source, r, model));
            refs.push(...list.map((r) => recordRef(source, r)));
          }
          return { content: JSON.stringify(out), records: refs };
        }
        default:
          throw new ToolInputError(`"${name}" isn’t a read tool`);
      }
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof HttpException)
        return { content: errorText(error), isError: true, records: [] };
      throw error;
    }
  }

  /**
   * Turns a write tool call into a proposal the user can approve, after checking it would
   * succeed. Returns an error outcome instead if it wouldn't (the model can then fix it).
   */
  async propose(
    ctx: RecordContext,
    toolUseId: string,
    name: ToolName,
    input: unknown,
  ): Promise<{ action?: ProposedAction; error?: ToolOutcome }> {
    try {
      const model = await this.models.load(ctx.workspace);
      if (name === 'create_record') {
        const args = this.parse(name, input);
        const object = this.object(model, args.object);
        await this.records.validate(ctx, object.namePlural, args.data, 'create');
        return {
          action: {
            toolUseId,
            kind: 'create',
            object: object.nameSingular,
            objectLabel: object.labelSingular,
            changes: await this.changes(model, object, args.data),
            status: 'pending',
          },
        };
      }
      if (name === 'update_record') {
        const args = this.parse(name, input);
        const object = this.object(model, args.object);
        await this.records.validate(ctx, object.namePlural, args.data, 'update', args.id);
        const current = await this.records.get(ctx, object.namePlural, args.id);
        return {
          action: {
            toolUseId,
            kind: 'update',
            object: object.nameSingular,
            objectLabel: object.labelSingular,
            record: recordRef(object, current),
            changes: await this.changes(model, object, args.data, current),
            status: 'pending',
          },
        };
      }
      throw new ToolInputError(`"${name}" isn’t a write tool`);
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof HttpException) {
        return {
          error: {
            content: `Not proposed, it would fail: ${errorText(error)}`,
            isError: true,
            records: [],
          },
        };
      }
      throw error;
    }
  }

  /** The proposed field changes, with readable labels for selects and relations. */
  private async changes(
    model: WorkspaceModel,
    object: ObjectModel,
    data: Record<string, unknown>,
    current?: RecordDto,
  ): Promise<ProposedChange[]> {
    const changes: ProposedChange[] = [];
    for (const [key, after] of Object.entries(data)) {
      if (key === 'targets' && isActivityObject(object) && Array.isArray(after)) {
        const refs = await this.activities.refs(model, after as { object: string; id: string }[]);
        changes.push({
          field: key,
          label: 'Linked to',
          after,
          afterText: refs.map((r) => r.title).join(', '),
        });
        continue;
      }
      const field = object.fields.find((f) => f.apiKey === key);
      const change: ProposedChange = { field: key, label: field?.label ?? key, after };
      if (current) change.before = current[key] ?? null;
      if (field) {
        const afterText = await this.records.describeValue(model, field, after);
        if (afterText) change.afterText = afterText;
        const beforeText = current
          ? await this.records.describeValue(model, field, change.before)
          : undefined;
        if (beforeText) change.beforeText = beforeText;
      }
      changes.push(change);
    }
    return changes;
  }

  /** Performs an approved write. */
  async apply(ctx: RecordContext, name: ToolName, input: unknown): Promise<ToolOutcome> {
    try {
      const model = await this.models.load(ctx.workspace);
      if (name === 'create_record') {
        const args = this.parse(name, input);
        const object = this.object(model, args.object);
        const record = await this.records.create(ctx, object.namePlural, args.data);
        return {
          content: JSON.stringify({ created: compact(object, record, model) }),
          records: [recordRef(object, record)],
        };
      }
      const args = this.parse('update_record', input);
      const object = this.object(model, args.object);
      const record = await this.records.update(ctx, object.namePlural, args.id, args.data);
      return {
        content: JSON.stringify({ updated: compact(object, record, model) }),
        records: [recordRef(object, record)],
      };
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof HttpException)
        return { content: errorText(error), isError: true, records: [] };
      throw error;
    }
  }
}
