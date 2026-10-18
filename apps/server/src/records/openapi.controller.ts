import { Controller, Get, Req } from '@nestjs/common';
import { ApiExcludeController, OpenAPIObject } from '@nestjs/swagger';
import { AuthedRequest, OptionalAuth } from '../auth/auth.decorators';
import { buildWorkspaceOpenApi } from './openapi';
import { WorkspaceModelService } from './workspace-model.service';

let baseDocument: OpenAPIObject | undefined;

/** Called once by setupApp with the document generated from the controllers. */
export function setBaseOpenApiDocument(document: OpenAPIObject) {
  baseDocument = document;
}

/** What /api/docs loads. Logged in: tailored to your workspace's objects. Logged out: generic. */
@ApiExcludeController()
@Controller()
export class OpenApiController {
  constructor(private readonly models: WorkspaceModelService) {}

  @OptionalAuth()
  @Get('openapi.json')
  async document(@Req() req: AuthedRequest): Promise<OpenAPIObject> {
    if (!baseDocument) throw new Error('OpenAPI document not initialised');
    if (!req.auth) return baseDocument;
    const model = await this.models.load(req.auth.workspace);
    return buildWorkspaceOpenApi(baseDocument, model, req.auth.workspace.name);
  }
}
