import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { WorkspaceRole } from '@crm-replica/shared';
import type { Request } from 'express';
import type { UserEntity } from './user.entity';
import type { WorkspaceEntity } from '../workspace/workspace.entity';

/** Who is making the request. Set by JwtAuthGuard on every non-public route. */
export interface AuthContext {
  user: UserEntity;
  workspace: WorkspaceEntity;
}

export type AuthedRequest = Request & { auth?: AuthContext };

export const IS_PUBLIC = 'auth:isPublic';
/** Opt a route (or controller) out of authentication. Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'auth:roles';
/** Restrict a route to the given workspace roles, e.g. `@Roles(WorkspaceRole.ADMIN)`. */
export const Roles = (...roles: WorkspaceRole[]) => SetMetadata(ROLES, roles);

/** Injects the AuthContext of the current request. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('@Auth() used on a route without authentication');
  return auth;
});
