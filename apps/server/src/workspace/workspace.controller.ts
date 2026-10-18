import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  InviteInfoResponse,
  InviteLinkResponse,
  MemberDto,
  WorkspaceRole,
  WorkspaceSummary,
} from '@crm-replica/shared';
import { Auth, AuthContext, Public, Roles } from '../auth/auth.decorators';
import { UpdateMemberDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@ApiCookieAuth()
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Patch()
  @Roles(WorkspaceRole.ADMIN)
  async rename(
    @Auth() { workspace }: AuthContext,
    @Body() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceSummary> {
    const updated = await this.workspaces.rename(workspace, dto.name);
    return { id: updated.id, name: updated.name };
  }

  @Get('members')
  members(@Auth() { workspace }: AuthContext): Promise<MemberDto[]> {
    return this.workspaces.listMembers(workspace.id);
  }

  @Patch('members/:id')
  @Roles(WorkspaceRole.ADMIN)
  updateMember(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.workspaces.updateRole(workspace.id, id, dto.role);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @Roles(WorkspaceRole.ADMIN)
  async removeMember(
    @Auth() { workspace, user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.workspaces.removeMember(workspace.id, user.id, id);
  }

  @Get('invite-link')
  @Roles(WorkspaceRole.ADMIN)
  inviteLink(@Auth() { workspace }: AuthContext): InviteLinkResponse {
    return this.workspaces.inviteLink(workspace);
  }

  @Post('invite-link/reset')
  @Roles(WorkspaceRole.ADMIN)
  resetInviteLink(@Auth() { workspace }: AuthContext): Promise<InviteLinkResponse> {
    return this.workspaces.resetInviteLink(workspace);
  }
}

@ApiTags('auth')
@Controller('invites')
export class InvitesController {
  constructor(private readonly workspaces: WorkspaceService) {}

  /** Lets the invite page show which workspace you're joining. */
  @Public()
  @Get(':token')
  async info(@Param('token') token: string): Promise<InviteInfoResponse> {
    const workspace = await this.workspaces.findByInviteToken(token);
    if (!workspace) throw new NotFoundException('This invite link is invalid or has been reset');
    return { workspaceName: workspace.name };
  }
}
