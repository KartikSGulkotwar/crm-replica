import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthedRequest, IS_PUBLIC } from './auth.decorators';
import { SESSION_COOKIE } from './session-cookie';
import { UserEntity } from './user.entity';

export interface SessionPayload {
  sub: string; // user id
  wid: string; // workspace id
}

/**
 * Global guard: every route needs a valid session cookie unless marked @Public().
 * The user is re-loaded on each request, so role changes and removals apply immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Please log in');

    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired; please log in again');
    }

    const user = await this.users.findOne({
      where: { id: payload.sub, workspaceId: payload.wid },
      relations: { workspace: true },
    });
    if (!user) throw new UnauthorizedException('Please log in');

    req.auth = { user, workspace: user.workspace };
    return true;
  }
}
