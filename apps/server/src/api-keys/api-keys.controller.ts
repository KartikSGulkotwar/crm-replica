import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiKeyDto, CreatedApiKeyDto, WorkspaceRole } from '@crm-replica/shared';
import { IsString, Length } from 'class-validator';
import { Auth, AuthContext, Roles } from '../auth/auth.decorators';
import { Trim } from '../common/validation';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @ApiProperty({ example: 'CLI on my laptop' })
  @Trim()
  @IsString()
  @Length(1, 60, { message: 'Name must be 1 to 60 characters' })
  name: string;
}

/** Admin-only: keys can change the data model. */
@ApiTags('api keys')
@ApiCookieAuth()
@Roles(WorkspaceRole.ADMIN)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@Auth() { workspace }: AuthContext): Promise<ApiKeyDto[]> {
    return this.keys.list(workspace.id);
  }

  /** The response contains the full key. It is shown only this once. */
  @Post()
  create(
    @Auth() { workspace, user }: AuthContext,
    @Body() body: CreateApiKeyDto,
  ): Promise<CreatedApiKeyDto> {
    return this.keys.create(workspace.id, user, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Auth() { workspace }: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.keys.revoke(workspace.id, id);
  }
}
