import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  createWorkflowSchema,
  runWorkflowSchema,
  saveDraftSchema,
  SaveDraftResponse,
  updateWorkflowSchema,
  WorkflowDto,
  WorkflowRunDto,
  WorkspaceRole,
} from '@crm-replica/shared';
import { z } from 'zod';
import { Auth, AuthContext, Roles } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkflowsService } from './workflows.service';

const docs = (schema: z.ZodType) => ({
  schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object,
});

/** Everyone can see workflows and run manual ones; only admins can change them. */
@ApiTags('workflows')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('workflows')
  list(@Auth() { workspace }: AuthContext): Promise<WorkflowDto[]> {
    return this.workflows.list(workspace.id);
  }

  @Get('workflows/:id')
  get(@Auth() { workspace }: AuthContext, @Param('id') id: string): Promise<WorkflowDto> {
    return this.workflows.get(workspace.id, id);
  }

  @Post('workflows')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(createWorkflowSchema))
  create(
    @Auth() { workspace, user }: AuthContext,
    @Body(new ZodValidationPipe(createWorkflowSchema)) body: z.output<typeof createWorkflowSchema>,
  ): Promise<WorkflowDto> {
    return this.workflows.create(workspace, user.id, body);
  }

  @Patch('workflows/:id')
  @Roles(WorkspaceRole.ADMIN)
  update(
    @Auth() { workspace }: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) body: z.output<typeof updateWorkflowSchema>,
  ): Promise<WorkflowDto> {
    return this.workflows.update(workspace.id, id, body);
  }

  @Delete('workflows/:id')
  @HttpCode(204)
  @Roles(WorkspaceRole.ADMIN)
  async remove(@Auth() { workspace }: AuthContext, @Param('id') id: string) {
    await this.workflows.remove(workspace.id, id);
  }

  /** Saves the draft version. The response lists anything that would block publishing. */
  @Put('workflows/:id/draft')
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody(docs(saveDraftSchema))
  saveDraft(
    @Auth() { workspace }: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) body: z.output<typeof saveDraftSchema>,
  ): Promise<SaveDraftResponse> {
    return this.workflows.saveDraft(workspace, id, body.definition);
  }

  @Delete('workflows/:id/draft')
  @Roles(WorkspaceRole.ADMIN)
  discardDraft(@Auth() { workspace }: AuthContext, @Param('id') id: string): Promise<WorkflowDto> {
    return this.workflows.discardDraft(workspace.id, id);
  }

  @Post('workflows/:id/publish')
  @HttpCode(200)
  @Roles(WorkspaceRole.ADMIN)
  publish(@Auth() { workspace }: AuthContext, @Param('id') id: string): Promise<WorkflowDto> {
    return this.workflows.publish(workspace, id);
  }

  @Post('workflows/:id/deactivate')
  @HttpCode(200)
  @Roles(WorkspaceRole.ADMIN)
  deactivate(@Auth() { workspace }: AuthContext, @Param('id') id: string): Promise<WorkflowDto> {
    return this.workflows.deactivate(workspace.id, id);
  }

  /** Runs a manual workflow (optionally on a record). */
  @Post('workflows/:id/run')
  @HttpCode(202)
  run(
    @Auth() { workspace, user }: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(runWorkflowSchema)) body: z.output<typeof runWorkflowSchema>,
  ): Promise<WorkflowRunDto> {
    return this.workflows.runManually(workspace, user.id, id, body.recordId);
  }

  /** Runs the draft once for real (marked as a test run). */
  @Post('workflows/:id/test')
  @HttpCode(202)
  @Roles(WorkspaceRole.ADMIN)
  test(
    @Auth() { workspace, user }: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(runWorkflowSchema)) body: z.output<typeof runWorkflowSchema>,
  ): Promise<WorkflowRunDto> {
    return this.workflows.testRun(workspace, user.id, id, body.recordId);
  }

  @Get('workflows/:id/runs')
  runs(
    @Auth() { workspace }: AuthContext,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<WorkflowRunDto[]> {
    return this.workflows.listRuns(workspace.id, id, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Get('workflow-runs/:runId')
  getRun(
    @Auth() { workspace }: AuthContext,
    @Param('runId') runId: string,
  ): Promise<WorkflowRunDto> {
    return this.workflows.getRun(workspace.id, runId);
  }
}
