import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceRole } from '@crm-replica/shared';
import { Auth, AuthContext, Roles } from '../auth/auth.decorators';
import { DemoDataResult, DemoDataService } from './demo-data.service';

@ApiTags('workspace')
@ApiCookieAuth()
@Controller('demo-data')
export class DemoDataController {
  constructor(private readonly demo: DemoDataService) {}

  @Get()
  async status(@Auth() { workspace }: AuthContext): Promise<{ loadedAt: string | null }> {
    const at = await this.demo.loadedAt(workspace.id);
    return { loadedAt: at ? new Date(at).toISOString() : null };
  }

  @Post()
  @HttpCode(201)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Add 30 companies, 60 people, 40 opportunities, notes and tasks (once)',
  })
  load(@Auth() { workspace, user }: AuthContext): Promise<DemoDataResult> {
    return this.demo.load(workspace, user.id);
  }
}
