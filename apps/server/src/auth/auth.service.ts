import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionResponse, WorkspaceRole } from '@crm-replica/shared';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { workspaceSchemaName } from '../database/workspace-schema';
import { StandardObjectsService } from '../metadata/standard-objects.service';
import { WorkspaceMembersService } from '../metadata/workspace-members.service';
import { newInviteToken } from '../workspace/invite-token';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { WorkspaceService } from '../workspace/workspace.service';
import { AcceptInviteDto, LoginDto, NewAccountDto, SignupDto } from './dto/auth.dto';
import { SessionPayload } from './jwt-auth.guard';
import { hashPassword, verifyPassword } from './password';
import { UserEntity } from './user.entity';

const EMAIL_TAKEN = 'An account with this email already exists';

export interface IssuedSession {
  token: string;
  session: SessionResponse;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly workspaces: WorkspaceService,
    private readonly standardObjects: StandardObjectsService,
    private readonly members: WorkspaceMembersService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  /**
   * Creates a workspace, its Postgres schema with the standard objects, and its first (admin)
   * user, all in one transaction.
   */
  async signup(dto: SignupDto): Promise<IssuedSession> {
    await this.assertEmailFree(dto.email);
    const { user, workspace } = await this.dataSource.transaction(async (em) => {
      const id = randomUUID();
      const workspace = await em.save(
        em.create(WorkspaceEntity, {
          id,
          name: dto.workspaceName,
          schemaName: workspaceSchemaName(id),
          inviteToken: newInviteToken(),
        }),
      );
      // The name is generated and validated by workspaceSchemaName, never taken from input.
      await em.query(`CREATE SCHEMA "${workspace.schemaName}"`);
      await this.standardObjects.seed(em, workspace);
      const user = await this.createUser(em, workspace, dto, WorkspaceRole.ADMIN);
      return { user, workspace };
    });
    return this.issue(user, workspace);
  }

  async login(dto: LoginDto): Promise<IssuedSession> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .innerJoinAndSelect('user.workspace', 'workspace')
      .where('user.email = :email', { email: dto.email })
      .getOne();
    const ok = await verifyPassword(dto.password, user?.passwordHash);
    if (!user || !ok) throw new UnauthorizedException('Incorrect email or password');
    return this.issue(user, user.workspace);
  }

  /** Joins the workspace behind an invite link as a member. */
  async acceptInvite(token: string, dto: AcceptInviteDto): Promise<IssuedSession> {
    const workspace = await this.workspaces.findByInviteToken(token);
    if (!workspace) throw new NotFoundException('This invite link is invalid or has been reset');
    await this.assertEmailFree(dto.email);
    const user = await this.dataSource.transaction((em) =>
      this.createUser(em, workspace, dto, WorkspaceRole.MEMBER),
    );
    return this.issue(user, workspace);
  }

  toSession(user: UserEntity, workspace: WorkspaceEntity): SessionResponse {
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspace: { id: workspace.id, name: workspace.name },
    };
  }

  private async createUser(
    em: EntityManager,
    workspace: WorkspaceEntity,
    dto: NewAccountDto,
    role: WorkspaceRole,
  ): Promise<UserEntity> {
    let user: UserEntity;
    try {
      user = await em.save(
        em.create(UserEntity, {
          workspaceId: workspace.id,
          email: dto.email,
          name: dto.name,
          passwordHash: await hashPassword(dto.password),
          role,
        }),
      );
    } catch (error) {
      // Two signups with the same email at once: the unique index catches the second.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }
    await this.members.upsert(em, workspace, user);
    return user;
  }

  private async assertEmailFree(email: string) {
    if (await this.users.existsBy({ email })) throw new ConflictException(EMAIL_TAKEN);
  }

  private async issue(user: UserEntity, workspace: WorkspaceEntity): Promise<IssuedSession> {
    const payload: SessionPayload = { sub: user.id, wid: workspace.id };
    return { token: await this.jwt.signAsync(payload), session: this.toSession(user, workspace) };
  }
}
