import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthedRequest, IS_OPTIONAL_AUTH, IS_PUBLIC } from './auth.decorators';
import { SESSION_COOKIE } from './session-cookie';
import { ApiKeysService } from '../api-keys/api-keys.service';
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
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!isOptional) return this.authenticate(req);
    try {
      return await this.authenticate(req);
    } catch {
      return true;
    }
  }

  private async authenticate(req: AuthedRequest): Promise<boolean> {
    // CLI and integrations: `Authorization: Bearer crm_…` (acts as the admin who created the key).
    const header = req.headers.authorization;
    if (header) {
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const user = match ? await this.apiKeys.authenticate(match[1]) : null;
      if (!user) throw new UnauthorizedException('Invalid or revoked API key');
      req.auth = { user, workspace: user.workspace, viaApiKey: true };
      return true;
    }

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
