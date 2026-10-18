import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createFieldSchema,
  createObjectSchema,
  FieldMetadataDto,
  MetadataExport,
  NormalizedFieldInput,
  ObjectMetadataDto,
  UpdateFieldInput,
  updateFieldSchema,
  UpdateObjectInput,
  updateObjectSchema,
  WorkspaceRole,
} from '@crm-replica/shared';
import { z } from 'zod';
import { Auth, AuthContext, Roles } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MetadataService, NormalizedObjectInput } from './metadata.service';

/** Request-body docs generated from the same zod schemas that validate the requests. */
const docs = (schema: z.ZodType) => ({
  schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object,
});

/** Reading the data model is open to every member; changing it is admin-only. */
@ApiTags('metadata')
@ApiCookieAuth()
@Controller('metadata')
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Get('objects')
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
  listObjects(
    @Auth() { workspace }: AuthContext,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<ObjectMetadataDto[]> {
    return this.metadata.listObjects(workspace.id, { includeDeleted: includeDeleted === 'true' });
  }

  /** By id, nameSingular or namePlural. */
  @Get('objects/:idOrName')
  getObject(
    @Auth() { workspace }: AuthContext,
    @Param('idOrName') idOrName: string,
  ): Promise<ObjectMetadataDto> {
    return this.metadata.getObject(workspace.id, idOrName);
  }

  /** The whole data model as JSON (used by `crm pull` and `crm diff`). */
  @Get('export')
  export(@Auth() { workspace }: AuthContext): Promise<MetadataExport> {
    return this.metadata.export(workspace.id);
  }

  @Post('objects')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(createObjectSchema))
  createObject(
    @Auth() { workspace }: AuthContext,
    @Body(new ZodValidationPipe(createObjectSchema)) body: NormalizedObjectInput,
  ): Promise<ObjectMetadataDto> {
    return this.metadata.createObject(workspace, body);
  }

  @Patch('objects/:id')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(updateObjectSchema))
  updateObject(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateObjectSchema)) body: UpdateObjectInput,
  ): Promise<ObjectMetadataDto> {
    return this.metadata.updateObject(workspace, id, body);
  }

  /** Soft delete: hidden, but the table and data are kept until permanently deleted. */
  @Delete('objects/:id')
  @Roles(WorkspaceRole.ADMIN)
  deleteObject(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ObjectMetadataDto> {
    return this.metadata.softDeleteObject(workspace, id);
  }

  @Post('objects/:id/restore')
  @Roles(WorkspaceRole.ADMIN)
  restoreObject(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ObjectMetadataDto> {
    return this.metadata.restoreObject(workspace, id);
  }

  /** Drops the table and all its records. Only for objects that are already soft-deleted. */
  @Delete('objects/:id/permanent')
  @HttpCode(204)
  @Roles(WorkspaceRole.ADMIN)
  async destroyObject(@Auth() { workspace }: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.metadata.destroyObject(workspace, id);
  }

  @Post('objects/:id/fields')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(createFieldSchema))
  createField(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createFieldSchema)) body: NormalizedFieldInput,
  ): Promise<FieldMetadataDto> {
    return this.metadata.createField(workspace, id, body);
  }

  @Patch('fields/:id')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(updateFieldSchema))
  updateField(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFieldSchema)) body: UpdateFieldInput,
  ): Promise<FieldMetadataDto> {
    return this.metadata.updateField(workspace, id, body);
  }

  @Delete('fields/:id')
  @Roles(WorkspaceRole.ADMIN)
  deleteField(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FieldMetadataDto> {
    return this.metadata.softDeleteField(workspace, id);
  }

  @Post('fields/:id/restore')
  @Roles(WorkspaceRole.ADMIN)
  restoreField(
    @Auth() { workspace }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FieldMetadataDto> {
    return this.metadata.restoreField(workspace, id);
  }

  @Delete('fields/:id/permanent')
  @HttpCode(204)
  @Roles(WorkspaceRole.ADMIN)
  async destroyField(@Auth() { workspace }: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.metadata.destroyField(workspace, id);
  }
}
