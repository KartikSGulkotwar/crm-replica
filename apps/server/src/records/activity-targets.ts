import { ACTIVITY_OBJECTS, recordTargetSchema } from '@crm-replica/shared';
import { EntityManager } from 'typeorm';
import { z } from 'zod';
import { qualified } from '../schema-sync/sql';
import { ObjectModel, WorkspaceModel } from './object-model';
import { RecordValidationError } from './value-codec';

/**
 * Notes and tasks can be linked to any records (a company, a person, a custom object…).
 * Links live in core.activity_target, keyed by object name + record id.
 */

export const MAX_TARGETS = 20;

export const isActivityObject = (object: ObjectModel) =>
  (ACTIVITY_OBJECTS as readonly string[]).includes(object.nameSingular) && !object.isSystem;

export interface ResolvedTarget {
  object: ObjectModel;
  id: string;
}

const targetsSchema = z.array(recordTargetSchema).max(MAX_TARGETS);

/**
 * Takes `targets` out of a note / task body (it isn't a field). Returns null targets when the
 * body has none, so callers can tell "not given" from "empty".
 */
export function splitTargets(
  object: ObjectModel,
  body: unknown,
): { body: unknown; targets: z.infer<typeof targetsSchema> | null } {
  if (!isActivityObject(object) || !body || typeof body !== 'object' || !('targets' in body)) {
    return { body, targets: null };
  }
  const { targets, ...rest } = body as Record<string, unknown>;
  const parsed = targetsSchema.safeParse(targets);
  if (!parsed.success) {
    throw new RecordValidationError([
      `targets: a list of up to ${MAX_TARGETS} {"object": "company", "id": "<record id>"}`,
    ]);
  }
  return { body: rest, targets: parsed.data };
}

/** Checks each target is a live record of a normal object. Duplicates are dropped. */
export async function resolveTargets(
  em: EntityManager,
  model: WorkspaceModel,
  targets: { object: string; id: string }[],
): Promise<ResolvedTarget[]> {
  const resolved = new Map<string, ResolvedTarget>();
  for (const t of targets) {
    const object = model.objects.find(
      (o) => o.nameSingular === t.object || o.namePlural === t.object,
    );
    if (!object || object.isSystem || isActivityObject(object)) {
      throw new RecordValidationError([
        `targets: notes and tasks can’t be linked to "${t.object}"`,
      ]);
    }
    const [row] = (await em.query(
      `SELECT 1 FROM ${qualified(model.schema, object.tableName)} WHERE "id" = $1::uuid AND "deleted_at" IS NULL`,
      [t.id],
    )) as unknown[];
    if (!row) {
      throw new RecordValidationError([`targets: ${object.labelSingular} ${t.id} doesn’t exist`]);
    }
    resolved.set(`${object.nameSingular}:${t.id}`, { object, id: t.id });
  }
  return [...resolved.values()];
}

/** Replaces the links of a note / task. Returns the targets that weren't linked before. */
export async function replaceTargets(
  em: EntityManager,
  workspaceId: string,
  activity: { object: string; id: string },
  targets: ResolvedTarget[],
): Promise<ResolvedTarget[]> {
  const existing = (await em.query(
    `SELECT target_object, target_id FROM core.activity_target WHERE workspace_id = $1 AND activity_id = $2`,
    [workspaceId, activity.id],
  )) as { target_object: string; target_id: string }[];
  const had = new Set(existing.map((e) => `${e.target_object}:${e.target_id}`));
  await em.query(`DELETE FROM core.activity_target WHERE workspace_id = $1 AND activity_id = $2`, [
    workspaceId,
    activity.id,
  ]);
  if (targets.length) {
    await em.query(
      `INSERT INTO core.activity_target (workspace_id, activity_object, activity_id, target_object, target_id)
       SELECT $1, $2, $3, t.object, t.id FROM unnest($4::text[], $5::uuid[]) AS t(object, id)`,
      [
        workspaceId,
        activity.object,
        activity.id,
        targets.map((t) => t.object.nameSingular),
        targets.map((t) => t.id),
      ],
    );
  }
  return targets.filter((t) => !had.has(`${t.object.nameSingular}:${t.id}`));
}

/** The records each of these notes / tasks is linked to. */
export async function targetsOf(
  em: EntityManager,
  workspaceId: string,
  activityIds: string[],
): Promise<Map<string, { object: string; id: string }[]>> {
  const map = new Map<string, { object: string; id: string }[]>();
  if (!activityIds.length) return map;
  const rows = (await em.query(
    `SELECT activity_id, target_object, target_id FROM core.activity_target
     WHERE workspace_id = $1 AND activity_id = ANY($2::uuid[]) ORDER BY created_at`,
    [workspaceId, activityIds],
  )) as { activity_id: string; target_object: string; target_id: string }[];
  for (const r of rows) {
    const list = map.get(r.activity_id) ?? [];
    list.push({ object: r.target_object, id: r.target_id });
    map.set(r.activity_id, list);
  }
  return map;
}
