import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createViewSchema, updateViewSchema, ViewDto } from '@crm-replica/shared';
import { z } from 'zod';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ViewsService } from './views.service';

const docs = (schema: z.ZodType) => ({
  schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object,
});

@ApiTags('views')
@ApiCookieAuth()
@Controller('views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  /** All views of an object (its default view is created on first request). */
  @Get()
  @ApiQuery({ name: 'object', example: 'companies' })
  list(@Auth() { workspace }: AuthContext, @Query('object') object: string): Promise<ViewDto[]> {
    return this.views.list(workspace, object ?? '');
  }

  @Get(':id')
  get(@Auth() { workspace }: AuthContext, @Param('id') id: string): Promise<ViewDto> {
    return this.views.get(workspace, id);
  }

  @Post()
  @ApiBody(docs(createViewSchema))
  create(
    @Auth() { workspace, user }: AuthContext,
    @Body(new ZodValidationPipe(createViewSchema)) body: z.output<typeof createViewSchema>,
  ): Promise<ViewDto> {
    return this.views.create(workspace, user.id, body);
  }

  /** Partial update; `fields`, `filters` and `sorts` replace the whole list when sent. */
  @Patch(':id')
  @ApiBody(docs(updateViewSchema))
  update(
    @Auth() { workspace }: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateViewSchema)) body: z.output<typeof updateViewSchema>,
  ): Promise<ViewDto> {
    return this.views.update(workspace, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() { workspace }: AuthContext, @Param('id') id: string) {
    await this.views.remove(workspace, id);
  }
}
