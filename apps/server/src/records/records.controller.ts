import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ListRecordsResponse, RecordDto } from '@crm-replica/shared';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { RecordContext, RecordsService } from './records.service';

const ctxOf = ({ workspace, user }: AuthContext): RecordContext => ({ workspace, userId: user.id });

/**
 * One controller for every object. When you're logged in, /api/docs lists concrete endpoints
 * and fields for each of your workspace's objects (see openapi.controller.ts).
 */
@ApiTags('records')
@ApiCookieAuth()
@Controller('objects')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get(':plural')
  @ApiOperation({ summary: 'List records' })
  @ApiParam({ name: 'plural', example: 'companies' })
  @ApiQuery({
    name: 'filter',
    required: false,
    description: 'JSON filter tree, e.g. {"field":"name","op":"contains","value":"acme"}',
  })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. name:asc,createdAt:desc' })
  @ApiQuery({ name: 'limit', required: false, description: '1-200, default 50' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'pageInfo.endCursor from the previous page',
  })
  @ApiQuery({
    name: 'expand',
    required: false,
    description: 'Relations to include, e.g. company,people',
  })
  list(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Query('filter') filter?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('expand') expand?: string,
  ): Promise<ListRecordsResponse> {
    return this.records.list(ctxOf(auth), plural, { filter, sort, limit, cursor, expand });
  }

  @Get(':plural/:id')
  @ApiOperation({ summary: 'Get one record' })
  @ApiQuery({ name: 'expand', required: false })
  get(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
    @Query('expand') expand?: string,
  ): Promise<RecordDto> {
    return this.records.get(ctxOf(auth), plural, id, expand);
  }

  @Post(':plural')
  @ApiOperation({ summary: 'Create a record' })
  @ApiBody({ schema: { type: 'object', example: { name: 'Acme' } } })
  create(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    return this.records.create(ctxOf(auth), plural, body);
  }

  @Patch(':plural/:id')
  @ApiOperation({ summary: 'Update a record (only the fields you send)' })
  @ApiBody({ schema: { type: 'object', example: { name: 'Acme Inc.' } } })
  update(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    return this.records.update(ctxOf(auth), plural, id, body);
  }

  @Post(':plural/batch-delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete several records (soft delete)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string', format: 'uuid' } } },
    },
  })
  removeMany(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Body() body: unknown,
  ): Promise<{ deletedIds: string[] }> {
    return this.records.removeMany(ctxOf(auth), plural, body);
  }

  @Delete(':plural/:id')
  @ApiOperation({ summary: 'Delete a record (soft delete; can be restored)' })
  remove(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
  ): Promise<RecordDto> {
    return this.records.remove(ctxOf(auth), plural, id);
  }

  @Post(':plural/:id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a deleted record' })
  restore(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
  ): Promise<RecordDto> {
    return this.records.restore(ctxOf(auth), plural, id);
  }
}
