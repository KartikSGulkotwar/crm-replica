import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { qualified } from '../schema-sync/sql';
import { WorkspaceRef } from './metadata.service';
import { WORKSPACE_MEMBER_TABLE } from './standard-objects';

/**
 * Keeps the `workspaceMember` records in step with user accounts. The record id equals the
 * user id, so `created_by` and relations like Task.assignee can point at users directly.
 */
@Injectable()
export class WorkspaceMembersService {
  async upsert(
    em: EntityManager,
    workspace: WorkspaceRef,
    user: { id: string; name: string; email: string },
  ) {
    await em.query(
      `INSERT INTO ${qualified(workspace.schemaName, WORKSPACE_MEMBER_TABLE)} ("id", "name", "email", "created_by")
       VALUES ($1, $2, $3, $1)
       ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "email" = EXCLUDED."email", "updated_at" = now()`,
      [user.id, user.name, user.email],
    );
  }

  /** Relations pointing at the member (e.g. assigned tasks) are cleared by their foreign keys. */
  async remove(em: EntityManager, workspace: WorkspaceRef, userId: string) {
    await em.query(
      `DELETE FROM ${qualified(workspace.schemaName, WORKSPACE_MEMBER_TABLE)} WHERE "id" = $1`,
      [userId],
    );
  }
}
