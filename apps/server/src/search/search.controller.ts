import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SearchResultDto } from '@crm-replica/shared';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Find records of any object by name, email, domain or phone' })
  @ApiQuery({ name: 'q', description: 'Words to look for' })
  find(@Auth() { workspace, user }: AuthContext, @Query('q') q = ''): Promise<SearchResultDto[]> {
    return this.search.search({ workspace, userId: user.id }, String(q));
  }
}
