import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ListRecordsResponse,
  RECORDS_DEFAULT_LIMIT,
  RECORDS_MAX_LIMIT,
  RecordDto,
} from '@crm-replica/shared';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { RECORD_EVENTS, RecordEvent, RecordEventName } from '../events/record-events';
import { ident, qualified } from '../schema-sync/sql';
import { buildFilterSql, FilterError, parseFilterParam } from './filter-builder';
import { FieldModel, InverseRelationModel, ObjectModel, WorkspaceModel } from './object-model';
import { parseSortParam, SortPlan } from './sort-cursor';
import { SqlParams } from './sql-params';
import { parseRecordInput, RecordValidationError, rowToRecord, UUID } from './value-codec';
import { WorkspaceModelService } from './workspace-model.service';

/** Who is acting. `depth` > 0 means an automation caused this change (see RecordEvent). */
export interface RecordContext {
  workspace: { id: string; schemaName: string };
  userId: string | null;
  depth?: number;
}

export interface ListQuery {
  filter?: unknown;
  sort?: unknown;
  limit?: unknown;
  cursor?: unknown;
  expand?: unknown;
}

const MAX_EXPANDS = 5;
const MAX_BATCH = 200;
/** Records returned per parent for one-to-many expansions (e.g. a company's people). */
const INVERSE_EXPAND_LIMIT = 50;

type Row = Record<string, unknown>;

/**
 * Runs a query and returns its rows. TypeORM's Postgres driver returns `[rows, rowCount]`
 * (not just rows) for UPDATE/DELETE … RETURNING, so normalize that here.
 */
async function queryRows(em: EntityManager, sql: string, params: unknown[]): Promise<Row[]> {
  const result: unknown = await em.query(sql, params);
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as Row[];
  }
  return result as Row[];
}

/**
 * Generic CRUD for any object. All SQL is built here from metadata: table and column names
 * come from the workspace model (validated by ident/qualified), and values are bound params.
 */
@Injectable()
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly models: WorkspaceModelService,
    private readonly events: EventEmitter2,
  ) {}

  async list(ctx: RecordContext, plural: string, query: ListQuery): Promise<ListRecordsResponse> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    return this.wrap(async () => {
      const limit = parseLimit(query.limit);
      const filter = parseFilterParam(query.filter);
      const table = qualified(model.schema, object.tableName);

      const countParams = new SqlParams();
      const countWhere = ['t."deleted_at" IS NULL'];
      if (filter !== undefined) countWhere.push(buildFilterSql(object, filter, countParams));

      const params = new SqlParams();
      const where = ['t."deleted_at" IS NULL'];
      if (filter !== undefined) where.push(buildFilterSql(object, filter, params));
      const plan = new SortPlan(parseSortParam(object, query.sort), params);
      if (query.cursor !== undefined && query.cursor !== '') {
        if (typeof query.cursor !== 'string') throw new FilterError('Invalid cursor');
        where.push(plan.afterCursor(query.cursor, params));
      }
      const limitParam = params.add(limit + 1);

      const [rows, [{ n }]] = await Promise.all([
        this.dataSource.query(
          `SELECT t.*, ${plan.selectList()} FROM ${table} t WHERE ${where.join(' AND ')} ORDER BY ${plan.orderBy()} LIMIT ${limitParam}`,
          params.values,
        ) as Promise<Row[]>,
        this.dataSource.query(
          `SELECT count(*)::int AS n FROM ${table} t WHERE ${countWhere.join(' AND ')}`,
          countParams.values,
        ) as Promise<{ n: number }[]>,
      ]);

      const page = rows.slice(0, limit);
      const data = page.map((r) => rowToRecord(object, r));
      await this.expand(model, object, data, query.expand);
      return {
        data,
        pageInfo: {
          hasNextPage: rows.length > limit,
          endCursor: page.length ? plan.encodeCursor(page[page.length - 1]) : null,
        },
        totalCount: n,
      };
    });
  }

  async get(ctx: RecordContext, plural: string, id: string, expand?: unknown): Promise<RecordDto> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    return this.wrap(async () => {
      const row = await this.findRow(this.dataSource.manager, model, object, id);
      const record = rowToRecord(object, row);
      await this.expand(model, object, [record], expand);
      return record;
    });
  }

  async create(ctx: RecordContext, plural: string, body: unknown): Promise<RecordDto> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    assertWritable(object);
    const record = await this.wrap(async () => {
      const input = parseRecordInput(object, body, 'create');
      await this.assertRelationTargets(this.dataSource.manager, model, input.relationIds);
      const params = new SqlParams();
      const table = qualified(model.schema, object.tableName);
      const names = [...input.columns.map((c) => ident(c.column)), '"created_by"'];
      const values = [
        ...input.columns.map((c) => `${params.add(c.value)}::${c.cast}`),
        `${params.add(ctx.userId)}::uuid`,
      ];
      if (!input.columns.some((c) => c.column === 'position')) {
        // New records go to the end of the manual order.
        names.push('"position"');
        values.push(`(SELECT COALESCE(MAX("position"), 0) + 1 FROM ${table})`);
      }
      const [row] = (await this.dataSource.query(
        `INSERT INTO ${table} (${names.join(', ')}) VALUES (${values.join(', ')}) RETURNING *`,
        params.values,
      )) as Row[];
      return rowToRecord(object, row);
    });
    await this.emit(RECORD_EVENTS.CREATED, ctx, object, record);
    return record;
  }

  /**
   * Checks a create/update body exactly as the real call would (values, required fields,
   * linked records) without writing anything. Used to vet changes before asking for approval.
   */
  async validate(
    ctx: RecordContext,
    plural: string,
    body: unknown,
    mode: 'create' | 'update',
    id?: string,
  ): Promise<void> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    assertWritable(object);
    await this.wrap(async () => {
      if (mode === 'update') await this.findRow(this.dataSource.manager, model, object, id ?? '');
      const input = parseRecordInput(object, body, mode);
      await this.assertRelationTargets(this.dataSource.manager, model, input.relationIds);
    });
  }

  async update(ctx: RecordContext, plural: string, id: string, body: unknown): Promise<RecordDto> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    assertWritable(object);
    const result = await this.wrap(() =>
      this.dataSource.transaction(async (em) => {
        const input = parseRecordInput(object, body, 'update');
        const before = rowToRecord(object, await this.findRow(em, model, object, id, true));
        if (!input.columns.length) return { before, after: before, changed: [] as string[] };
        await this.assertRelationTargets(em, model, input.relationIds);
        const params = new SqlParams();
        const sets = input.columns.map(
          (c) => `${ident(c.column)} = ${params.add(c.value)}::${c.cast}`,
        );
        const [row] = await queryRows(
          em,
          `UPDATE ${qualified(model.schema, object.tableName)} SET ${sets.join(', ')}, "updated_at" = now()
           WHERE "id" = ${params.add(id)}::uuid AND "deleted_at" IS NULL RETURNING *`,
          params.values,
        );
        const after = rowToRecord(object, row);
        const changed = input.keys.filter(
          (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
        );
        return { before, after, changed };
      }),
    );
    if (result.changed.length) {
      await this.emit(RECORD_EVENTS.UPDATED, ctx, object, result.after, {
        before: result.before,
        changedFields: result.changed,
      });
    }
    return result.after;
  }

  /** Soft delete: the record disappears from lists but stays in the table and can be restored. */
  async remove(ctx: RecordContext, plural: string, id: string): Promise<RecordDto> {
    return this.setDeleted(ctx, plural, id, true);
  }

  /** Soft-deletes several records at once (e.g. "Delete selected" in the table). */
  async removeMany(
    ctx: RecordContext,
    plural: string,
    body: unknown,
  ): Promise<{ deletedIds: string[] }> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    assertWritable(object);
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_BATCH ||
      !ids.every((id) => typeof id === 'string' && UUID.test(id))
    ) {
      throw new BadRequestException(`ids must be a list of 1 to ${MAX_BATCH} record ids`);
    }
    const rows = await queryRows(
      this.dataSource.manager,
      `UPDATE ${qualified(model.schema, object.tableName)} SET "deleted_at" = now(), "updated_at" = now()
       WHERE "id" = ANY($1::uuid[]) AND "deleted_at" IS NULL RETURNING *`,
      [ids],
    );
    for (const row of rows)
      await this.emit(RECORD_EVENTS.DELETED, ctx, object, rowToRecord(object, row));
    return { deletedIds: rows.map((r) => r.id as string) };
  }

  async restore(ctx: RecordContext, plural: string, id: string): Promise<RecordDto> {
    return this.setDeleted(ctx, plural, id, false);
  }

  private async setDeleted(
    ctx: RecordContext,
    plural: string,
    id: string,
    deleted: boolean,
  ): Promise<RecordDto> {
    const { model, object } = await this.models.object(ctx.workspace, plural);
    assertWritable(object);
    if (!UUID.test(id)) throw new NotFoundException(`${object.labelSingular} not found`);
    const rows = await queryRows(
      this.dataSource.manager,
      `UPDATE ${qualified(model.schema, object.tableName)}
       SET "deleted_at" = ${deleted ? 'now()' : 'NULL'}, "updated_at" = now()
       WHERE "id" = $1::uuid AND "deleted_at" IS ${deleted ? 'NULL' : 'NOT NULL'} RETURNING *`,
      [id],
    );
    if (!rows.length)
      throw new NotFoundException(
        deleted
          ? `${object.labelSingular} not found`
          : `No deleted ${object.labelSingular.toLowerCase()} with this id`,
      );
    const record = rowToRecord(object, rows[0]);
    await this.emit(deleted ? RECORD_EVENTS.DELETED : RECORD_EVENTS.RESTORED, ctx, object, record);
    return record;
  }

  private async findRow(
    em: EntityManager,
    model: WorkspaceModel,
    object: ObjectModel,
    id: string,
    lock = false,
  ): Promise<Row> {
    if (!UUID.test(id)) throw new NotFoundException(`${object.labelSingular} not found`);
    const [row] = (await em.query(
      `SELECT * FROM ${qualified(model.schema, object.tableName)} WHERE "id" = $1::uuid AND "deleted_at" IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Row[];
    if (!row) throw new NotFoundException(`${object.labelSingular} not found`);
    return row;
  }

  /** Relations must point at live records of the right object (the FK alone allows soft-deleted ones). */
  private async assertRelationTargets(
    em: EntityManager,
    model: WorkspaceModel,
    ids: { field: FieldModel; id: string }[],
  ) {
    const errors: string[] = [];
    for (const { field, id } of ids) {
      const target = model.objects.find((o) => o.nameSingular === field.relationTarget)!;
      const found = await em.query(
        `SELECT 1 FROM ${qualified(model.schema, target.tableName)} WHERE "id" = $1::uuid AND "deleted_at" IS NULL`,
        [id],
      );
      if (!found.length)
        errors.push(`${field.apiKey}: no ${target.labelSingular.toLowerCase()} with id ${id}`);
    }
    if (errors.length) throw new RecordValidationError(errors);
  }

  /**
   * `expand=company,people`: many-to-one relations become the linked record (or null);
   * reverse relations become a list (first 50 per record, in manual order).
   */
  private async expand(
    model: WorkspaceModel,
    object: ObjectModel,
    records: RecordDto[],
    raw: unknown,
  ) {
    if (raw === undefined || raw === '' || !records.length) return;
    if (typeof raw !== 'string') throw new FilterError('expand must be a comma-separated list');
    const names = [
      ...new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (names.length > MAX_EXPANDS)
      throw new FilterError(`At most ${MAX_EXPANDS} relations can be expanded`);

    for (const name of names) {
      const field = object.fields.find((f) => f.name === name && f.relationTarget);
      const inverse = object.inverseRelations.find((r) => r.name === name);
      if (field) await this.expandManyToOne(model, field, records);
      else if (inverse) await this.expandOneToMany(model, inverse, records);
      else {
        const options = [
          ...object.fields.filter((f) => f.relationTarget).map((f) => f.name),
          ...object.inverseRelations.map((r) => r.name),
        ];
        throw new FilterError(
          `Can’t expand "${name}" on ${object.labelSingular}${options.length ? `; try: ${options.join(', ')}` : ''}`,
        );
      }
    }
  }

  private async expandManyToOne(model: WorkspaceModel, field: FieldModel, records: RecordDto[]) {
    const target = model.objects.find((o) => o.nameSingular === field.relationTarget)!;
    const ids = [
      ...new Set(
        records.map((r) => r[field.apiKey]).filter((v): v is string => typeof v === 'string'),
      ),
    ];
    const rows = ids.length
      ? ((await this.dataSource.query(
          `SELECT * FROM ${qualified(model.schema, target.tableName)} WHERE "id" = ANY($1::uuid[]) AND "deleted_at" IS NULL`,
          [ids],
        )) as Row[])
      : [];
    const byId = new Map(rows.map((r) => [r.id as string, rowToRecord(target, r)]));
    for (const record of records)
      record[field.name] = byId.get(record[field.apiKey] as string) ?? null;
  }

  private async expandOneToMany(
    model: WorkspaceModel,
    inverse: InverseRelationModel,
    records: RecordDto[],
  ) {
    const source = model.objects.find((o) => o.nameSingular === inverse.sourceObject)!;
    const fk = ident(inverse.sourceField.columns[0].column);
    const rows = (await this.dataSource.query(
      `SELECT * FROM (
         SELECT s.*, row_number() OVER (PARTITION BY s.${fk} ORDER BY s."position", s."id") AS __rn
         FROM ${qualified(model.schema, source.tableName)} s
         WHERE s.${fk} = ANY($1::uuid[]) AND s."deleted_at" IS NULL
       ) x WHERE x.__rn <= $2`,
      [records.map((r) => r.id), INVERSE_EXPAND_LIMIT],
    )) as Row[];
    const column = inverse.sourceField.columns[0].column;
    for (const record of records) {
      record[inverse.name] = rows
        .filter((r) => r[column] === record.id)
        .map((r) => rowToRecord(source, r));
    }
  }

  private async emit(
    name: RecordEventName,
    ctx: RecordContext,
    object: ObjectModel,
    record: RecordDto,
    extra: Partial<RecordEvent> = {},
  ) {
    const event: RecordEvent = {
      name,
      workspaceId: ctx.workspace.id,
      objectName: object.nameSingular,
      recordId: record.id,
      record,
      actorUserId: ctx.userId,
      depth: ctx.depth ?? 0,
      occurredAt: new Date().toISOString(),
      ...extra,
    };
    try {
      await this.events.emitAsync(name, event);
    } catch (error) {
      // The change is already committed; a failing listener must not turn it into an error.
      this.logger.error(`Listener for ${name} failed: ${(error as Error).message}`);
    }
  }

  /** Maps validation errors and Postgres errors to clean 400s. */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RecordValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: error.messages,
        });
      }
      if (error instanceof FilterError) throw new BadRequestException(error.message);
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string }).code;
        if (code === '23505') throw new BadRequestException('A record with this id already exists');
        if (code === '23503') throw new BadRequestException('A linked record doesn’t exist');
        if (code === '22003') throw new BadRequestException('A number is out of range');
      }
      throw error;
    }
  }
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return RECORDS_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > RECORDS_MAX_LIMIT)
    throw new FilterError(`limit must be a whole number from 1 to ${RECORDS_MAX_LIMIT}`);
  return n;
}

function assertWritable(object: ObjectModel) {
  if (object.isSystem) {
    throw new ForbiddenException(
      `${object.labelPlural} are read-only here; manage them in Settings → Members`,
    );
  }
}
