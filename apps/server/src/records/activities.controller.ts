import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activityTargetsSchema,
  ActivityTargetsInput,
  RecordActivitiesDto,
  RecordRef,
} from '@crm-replica/shared';
import { z } from 'zod';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ActivitiesService } from './activities.service';
import { RecordContext } from './records.service';

const ctxOf = ({ workspace, user, viaApiKey }: AuthContext): RecordContext => ({
  workspace,
  userId: user.id,
  source: viaApiKey ? 'api' : 'user',
});

/**
 * Notes and tasks linked to records. To create one already linked, POST it to
 * /objects/notes (or tasks) with `"targets": [{"object": "company", "id": "…"}]`.
 */
@ApiTags('records')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('objects')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get(':plural/:id/activities')
  @ApiOperation({ summary: 'Notes and tasks linked to a record' })
  forRecord(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
  ): Promise<RecordActivitiesDto> {
    return this.activities.forRecord(ctxOf(auth), plural, id);
  }

  @Get(':plural/:id/targets')
  @ApiOperation({ summary: 'Records a note or task is linked to' })
  targets(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
  ): Promise<RecordRef[]> {
    return this.activities.targets(ctxOf(auth), plural, id);
  }

  @Put(':plural/:id/targets')
  @ApiOperation({ summary: 'Replace the records a note or task is linked to' })
  @ApiBody({
    schema: z.toJSONSchema(activityTargetsSchema, { io: 'input' }) as object,
  })
  setTargets(
    @Auth() auth: AuthContext,
    @Param('plural') plural: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(activityTargetsSchema)) body: ActivityTargetsInput,
  ): Promise<RecordRef[]> {
    return this.activities.setTargets(ctxOf(auth), plural, id, body.targets);
  }
}
