import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { applyRequestSchema, ApplyResult, WorkspaceRole } from '@crm-replica/shared';
import { z } from 'zod';
import { Auth, AuthContext, Roles } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AppsService } from './apps.service';

@ApiTags('metadata')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('metadata')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  /**
   * Applies an app's objects, fields and views (used by `crm push`; `crm diff` sends
   * dryRun). Returns the plan; 409 if it would delete data and allowDestructive isn't set.
   */
  @Post('apply')
  @HttpCode(200)
  @Roles(WorkspaceRole.ADMIN)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        manifest: { type: 'object' },
        dryRun: { type: 'boolean' },
        allowDestructive: { type: 'boolean' },
      },
    },
  })
  apply(
    @Auth() { workspace, user }: AuthContext,
    @Body(new ZodValidationPipe(applyRequestSchema)) body: z.output<typeof applyRequestSchema>,
  ): Promise<ApplyResult> {
    return this.apps.apply(workspace, user.id, body);
  }
}
