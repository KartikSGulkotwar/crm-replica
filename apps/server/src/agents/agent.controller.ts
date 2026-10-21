import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  AgentConversationDto,
  AgentConversationSummary,
  agentDecisionsSchema,
  AgentDecisionsInput,
  agentMessageSchema,
  AgentMessageInput,
  AgentStatusDto,
  AgentStreamEvent,
} from '@crm-replica/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, AuthContext } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgentContext, AgentService } from './agent.service';

const docs = (schema: z.ZodType) => ({
  schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object,
});

const ctxOf = ({ workspace, user }: AuthContext): AgentContext => ({
  workspace,
  userId: user.id,
  userName: user.name,
  workspaceName: workspace.name,
});

/** Opens a Server-Sent Events response and returns a function that sends one event. */
function openStream(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (event: AgentStreamEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

/**
 * “Ask the CRM”. Every user has their own conversations. The assistant reads and proposes
 * changes as the signed-in user, so it can only see and change what that user can.
 */
@ApiTags('agent')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('status')
  status(): AgentStatusDto {
    return this.agent.status();
  }

  @Get('conversations')
  list(@Auth() auth: AuthContext): Promise<AgentConversationSummary[]> {
    return this.agent.list(ctxOf(auth));
  }

  @Post('conversations')
  create(@Auth() auth: AuthContext): Promise<AgentConversationDto> {
    return this.agent.create(ctxOf(auth));
  }

  @Get('conversations/:id')
  get(@Auth() auth: AuthContext, @Param('id') id: string): Promise<AgentConversationDto> {
    return this.agent.get(ctxOf(auth), id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.agent.remove(ctxOf(auth), id);
  }

  /** Streams the answer as Server-Sent Events, ending with a `done` event. */
  @Post('conversations/:id/messages')
  @ApiBody(docs(agentMessageSchema))
  @ApiProduces('text/event-stream')
  async message(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(agentMessageSchema)) body: AgentMessageInput,
    @Res() res: Response,
  ) {
    const ctx = ctxOf(auth);
    // Errors before this point are ordinary JSON error responses.
    const conversation = await this.agent.prepareTurn(ctx, id, 'message');
    const emit = openStream(res);
    await this.agent.sendMessage(ctx, conversation, body.text, emit);
    res.end();
  }

  /** Approves or rejects the proposed changes, then streams the rest of the answer. */
  @Post('conversations/:id/decisions')
  @ApiBody(docs(agentDecisionsSchema))
  @ApiProduces('text/event-stream')
  async decisions(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(agentDecisionsSchema)) body: AgentDecisionsInput,
    @Res() res: Response,
  ) {
    const ctx = ctxOf(auth);
    const conversation = await this.agent.prepareTurn(ctx, id, 'decision');
    const emit = openStream(res);
    await this.agent.decide(ctx, conversation, body.decisions, emit);
    res.end();
  }
}
