import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@crm-replica/shared';
import { AuthedRequest, ROLES } from './auth.decorators';

/** Global guard (runs after JwtAuthGuard): enforces @Roles(...) when present. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const role = context.switchToHttp().getRequest<AuthedRequest>().auth?.user.role;
    if (role && roles.includes(role)) return true;
    throw new ForbiddenException('Only workspace admins can do this');
  }
}
