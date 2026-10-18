import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@crm-replica/shared';
import { RolesGuard } from './roles.guard';

function contextFor(role: WorkspaceRole | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ auth: role && { user: { role } } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('allows any signed-in user when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(undefined);
    expect(guard.canActivate(contextFor(WorkspaceRole.MEMBER))).toBe(true);
  });

  it('allows admins on admin-only routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce([WorkspaceRole.ADMIN]);
    expect(guard.canActivate(contextFor(WorkspaceRole.ADMIN))).toBe(true);
  });

  it('blocks members from admin-only routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce([WorkspaceRole.ADMIN]);
    expect(() => guard.canActivate(contextFor(WorkspaceRole.MEMBER))).toThrow(ForbiddenException);
  });
});
