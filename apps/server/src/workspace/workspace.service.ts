import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InviteLinkResponse, MemberDto, WorkspaceRole } from '@crm-replica/shared';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { loadEnv } from '../config/env';
import { isWellFormedInviteToken, newInviteToken } from './invite-token';
import { WorkspaceEntity } from './workspace.entity';

const LAST_ADMIN = 'A workspace needs at least one admin';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  findByInviteToken(token: string): Promise<WorkspaceEntity | null> {
    if (!isWellFormedInviteToken(token)) return Promise.resolve(null);
    return this.workspaces.findOneBy({ inviteToken: token });
  }

  async rename(workspace: WorkspaceEntity, name: string): Promise<WorkspaceEntity> {
    workspace.name = name;
    return this.workspaces.save(workspace);
  }

  inviteLink(workspace: WorkspaceEntity): InviteLinkResponse {
    const token = workspace.inviteToken;
    return { token, url: `${loadEnv().APP_URL}/invite/${token}` };
  }

  /** Issues a new token; the previous link stops working. */
  async resetInviteLink(workspace: WorkspaceEntity): Promise<InviteLinkResponse> {
    workspace.inviteToken = newInviteToken();
    await this.workspaces.save(workspace);
    return this.inviteLink(workspace);
  }

  async listMembers(workspaceId: string): Promise<MemberDto[]> {
    const users = await this.users.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    return users.map(toMemberDto);
  }

  async updateRole(workspaceId: string, memberId: string, role: WorkspaceRole): Promise<MemberDto> {
    return this.dataSource.transaction(async (em) => {
      const member = await this.findMember(em, workspaceId, memberId);
      if (member.role === WorkspaceRole.ADMIN && role !== WorkspaceRole.ADMIN) {
        await this.assertAnotherAdmin(em, workspaceId, member.id);
      }
      member.role = role;
      return toMemberDto(await em.save(member));
    });
  }

  async removeMember(workspaceId: string, actorId: string, memberId: string): Promise<void> {
    if (memberId === actorId) throw new BadRequestException('You can’t remove yourself');
    await this.dataSource.transaction(async (em) => {
      const member = await this.findMember(em, workspaceId, memberId);
      if (member.role === WorkspaceRole.ADMIN)
        await this.assertAnotherAdmin(em, workspaceId, member.id);
      await em.remove(member);
    });
  }

  private async findMember(em: EntityManager, workspaceId: string, memberId: string) {
    const member = await em.findOne(UserEntity, {
      where: { id: memberId, workspaceId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  /** Locks the workspace's admin rows so two concurrent demotions can't remove every admin. */
  private async assertAnotherAdmin(em: EntityManager, workspaceId: string, exceptId: string) {
    const admins = await em.find(UserEntity, {
      where: { workspaceId, role: WorkspaceRole.ADMIN },
      lock: { mode: 'pessimistic_write' },
    });
    if (!admins.some((a) => a.id !== exceptId)) throw new BadRequestException(LAST_ADMIN);
  }
}

function toMemberDto(user: UserEntity): MemberDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
