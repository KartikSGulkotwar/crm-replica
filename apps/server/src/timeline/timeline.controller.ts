import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TimelinePage } from '@crm-replica/shared';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { TimelineService } from './timeline.service';

@ApiTags('timeline')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller()
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get('objects/:plural/:id/timeline')
  @ApiOperation({ summary: 'A record’s history, newest first' })
  @ApiQuery({ name: 'before', required: false, description: 'nextCursor from the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: '1-100, default 30' })
  forRecord(
    @Auth() { workspace, user }: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<TimelinePage> {
    return this.timeline.forRecord({ workspace, userId: user.id }, plural, id, { before, limit });
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Recent changes across the workspace, newest first' })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'limit', required: false })
  feed(
    @Auth() { workspace, user }: AuthContext,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<TimelinePage> {
    return this.timeline.feed({ workspace, userId: user.id }, { before, limit });
  }
}
