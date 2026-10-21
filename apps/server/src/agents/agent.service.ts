import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Anthropic from '@anthropic-ai/sdk';
import {
  AgentConversationDto,
  AgentConversationSummary,
  AgentRecordRef,
  AgentStreamEvent,
  TranscriptItem,
} from '@crm-replica/shared';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { loadEnv } from '../config/env';
import { LlmClient } from '../llm/llm-client';
import { RecordContext } from '../records/records.service';
import { WorkspaceModelService } from '../records/workspace-model.service';
import { REDIS } from '../redis/redis.module';
import { AgentConversationEntity, PendingTurn } from './agent-conversation.entity';
import { AgentToolExecutor, buildTools, ToolName, WRITE_TOOLS } from './agent-tools';

/** Model turns per user message (each may call several tools). */
const MAX_TURNS = 12;
/** A turn holds its conversation's lock at most this long (if the process dies mid-turn). */
const BUSY_TTL_SECONDS = 15 * 60;
const busyKey = (conversationId: string) => `agent-busy:${conversationId}`;
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
type Emit = (event: AgentStreamEvent) => void;

/** Who is asking: record access runs as this user; the names go into the system prompt. */
export interface AgentContext extends RecordContext {
  userId: string;
  userName: string;
  workspaceName: string;
}
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const ACTIVITY: Record<string, (input: Record<string, unknown>) => string> = {
  list_objects: () => 'Looking at the data model…',
  describe_object: (i) => `Reading the ${i.object} fields…`,
  search_records: (i) => `Searching ${i.object} records…`,
  get_record: (i) => `Opening a ${i.object} record…`,
  create_record: (i) => `Preparing a new ${i.object}…`,
  update_record: (i) => `Preparing a change to a ${i.object}…`,
};

function systemPrompt(workspaceName: string, userName: string): string {
  return [
    `You are the assistant inside "${workspaceName}", a CRM. You help ${userName} find, understand and update their records.`,
    '',
    'How to work:',
    '- Use the tools to look things up. Never invent records, ids, numbers or field values; if something isn’t in the data, say so.',
    '- Call describe_object before filtering or writing an object you haven’t looked at in this conversation, so you use the right field keys and option values.',
    '- Prefer one well-filtered search over many small ones. When several lookups are independent, make the calls in parallel.',
    '- create_record and update_record only propose a change: the user sees it and approves or rejects it. Propose all the changes a request needs in one turn (for example, one create_record call per deal), and say briefly what you proposed. After the results come back, say what was done and what was rejected.',
    '- If the request is ambiguous in a way that changes which records you would modify, ask before proposing.',
    '',
    'How to answer:',
    '- Be concise. Lead with the answer, then the supporting details.',
    '- Mention records as Markdown links using the url from the tool results, e.g. [Acme](/objects/companies/<id>). Only use urls that tools returned.',
    '- Use short bullet lists for several records. Format money with its currency.',
    '',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].join('\n');
}

/**
 * Removes blocks that must not be sent back after a mid-output fallback: per the API's
 * fallback rules, thinking / tool_use blocks (and unpaired server tool calls) before the last
 * `fallback` block are omitted; everything after it is echoed unchanged.
 */
function echoable(content: ContentBlock[]): ContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFallback < 0) return content;
  const resultIds = new Set(
    content.flatMap((b) =>
      'tool_use_id' in b && typeof b.tool_use_id === 'string' ? [b.tool_use_id] : [],
    ),
  );
  return content.filter((b, i) => {
    if (i >= lastFallback) return true;
    if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use')
      return false;
    if (b.type === 'server_tool_use') return resultIds.has(b.id);
    return true;
  });
}

const now = () => new Date().toISOString();
const uniqueRecords = (records: AgentRecordRef[]) => [
  ...new Map(records.map((r) => [r.id, r])).values(),
];

/**
 * The “Ask the CRM” assistant: a tool-calling loop over the workspace's data. Read tools run
 * immediately; writes pause the loop until the user approves or rejects them. The message
 * history is append-only (what was sent stays exactly as sent).
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectRepository(AgentConversationEntity)
    private readonly conversations: Repository<AgentConversationEntity>,
    private readonly llm: LlmClient,
    private readonly tools: AgentToolExecutor,
    private readonly models: WorkspaceModelService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  status() {
    return {
      configured: this.llm.isConfigured(),
      model: this.llm.isConfigured() ? this.llm.model : null,
    };
  }

  async list(ctx: AgentContext): Promise<AgentConversationSummary[]> {
    const rows = await this.conversations.find({
      where: { workspaceId: ctx.workspace.id, userId: ctx.userId },
      order: { updatedAt: 'DESC' },
      take: 30,
      select: { id: true, title: true, updatedAt: true },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
  }

  async create(ctx: AgentContext): Promise<AgentConversationDto> {
    const saved = await this.conversations.save(
      this.conversations.create({
        workspaceId: ctx.workspace.id,
        userId: ctx.userId,
        title: 'New conversation',
        messages: [],
        transcript: [],
        pending: null,
      }),
    );
    return toDto(saved);
  }

  async get(ctx: AgentContext, id: string): Promise<AgentConversationDto> {
    return toDto(await this.find(ctx, id));
  }

  async remove(ctx: AgentContext, id: string): Promise<void> {
    const conversation = await this.find(ctx, id);
    await this.conversations.delete({ id: conversation.id });
  }

  /**
   * Checks everything that can fail before the response starts streaming, and reserves the
   * conversation for this turn (a Redis lock, so it holds across API instances).
   */
  async prepareTurn(
    ctx: AgentContext,
    id: string,
    kind: 'message' | 'decision',
  ): Promise<AgentConversationEntity> {
    if (!this.llm.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI assistant isn’t set up: add ANTHROPIC_API_KEY to the server’s .env and restart it.',
      );
    }
    const { id: conversationId } = await this.find(ctx, id);
    const locked = await this.redis.set(busyKey(conversationId), '1', 'EX', BUSY_TTL_SECONDS, 'NX');
    if (!locked)
      throw new ConflictException('The assistant is still answering in this conversation');
    try {
      // Reload now that this turn holds the lock, so a turn that just finished is seen.
      const conversation = await this.find(ctx, id);
      if (kind === 'message' && conversation.pending)
        throw new ConflictException('Approve or reject the proposed changes first');
      if (kind === 'decision' && !conversation.pending)
        throw new BadRequestException('There are no proposed changes waiting');
      await this.rateLimit(ctx.userId);
      return conversation;
    } catch (err) {
      await this.redis.del(busyKey(conversationId));
      throw err;
    }
  }

  async sendMessage(
    ctx: AgentContext,
    conversation: AgentConversationEntity,
    text: string,
    emit: Emit,
  ): Promise<void> {
    await this.exclusive(conversation, emit, async () => {
      conversation.messages.push({ role: 'user', content: text });
      conversation.transcript.push({ type: 'user', text, at: now() });
      if (conversation.title === 'New conversation')
        conversation.title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      await this.conversations.save(conversation);
      return this.loop(ctx, conversation, emit);
    });
  }

  /** Applies the approved writes, reports results to the model and continues the answer. */
  async decide(
    ctx: AgentContext,
    conversation: AgentConversationEntity,
    decisions: { toolUseId: string; approve: boolean }[],
    emit: Emit,
  ): Promise<void> {
    await this.exclusive(conversation, emit, async () => {
      const pending = conversation.pending!;
      const approved = new Set(decisions.filter((d) => d.approve).map((d) => d.toolUseId));
      const results = new Map(pending.readResults.map((r) => [r.tool_use_id, r]));
      const proposal = conversation.transcript.find(
        (t): t is Extract<TranscriptItem, { type: 'proposal' }> =>
          t.type === 'proposal' && t.id === pending.proposalId,
      );
      for (const write of pending.writes) {
        const action = proposal?.actions.find((a) => a.toolUseId === write.toolUseId);
        if (!approved.has(write.toolUseId)) {
          results.set(write.toolUseId, {
            type: 'tool_result',
            tool_use_id: write.toolUseId,
            content: 'The user rejected this change. It was not made.',
          });
          if (action) action.status = 'rejected';
          continue;
        }
        const outcome = await this.tools.apply(ctx, write.name as ToolName, write.input);
        results.set(write.toolUseId, {
          type: 'tool_result',
          tool_use_id: write.toolUseId,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
        if (action) {
          action.status = outcome.isError ? 'failed' : 'approved';
          if (outcome.isError) action.error = outcome.content;
          else action.result = outcome.records[0];
        }
      }
      if (proposal) emit({ type: 'proposal', id: proposal.id, actions: proposal.actions });
      // One user message with a result for every tool_use of the paused turn, in order.
      conversation.messages.push({
        role: 'user',
        content: pending.toolUseIds.map((id) => results.get(id)!),
      });
      conversation.pending = null;
      await this.conversations.save(conversation);
      const used = await this.loop(ctx, conversation, emit);
      // The changed records are worth linking too.
      return [
        ...(proposal?.actions.flatMap((a) =>
          a.result ? [a.result] : a.record ? [a.record] : [],
        ) ?? []),
        ...used,
      ];
    });
  }

  /** Runs model turns until an answer, a proposal or an error. Returns the records it looked at. */
  private async loop(
    ctx: AgentContext,
    conversation: AgentConversationEntity,
    emit: Emit,
  ): Promise<AgentRecordRef[]> {
    const used: AgentRecordRef[] = [];
    const model = await this.models.load(ctx.workspace);
    const tools = buildTools(model);
    const system = systemPrompt(ctx.workspaceName, ctx.userName);

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const answer: Extract<TranscriptItem, { type: 'assistant' }> = {
        type: 'assistant',
        text: '',
        records: [],
        at: now(),
      };
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await this.llm.streamTurn(
          {
            max_tokens: 32000,
            system,
            tools,
            messages: conversation.messages,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            // Cache the stable prefix (tools, system, earlier turns) across turns.
            cache_control: { type: 'ephemeral' },
          },
          (delta) => {
            answer.text += delta;
            emit({ type: 'text', text: delta });
          },
        );
      } catch (error) {
        this.logger.error(`Assistant request failed: ${(error as Error).message}`);
        const text =
          error instanceof Anthropic.RateLimitError
            ? 'The AI service is busy right now. Please try again in a moment.'
            : 'The AI service couldn’t answer just now. Please try again.';
        conversation.transcript.push({ type: 'error', text, at: now() });
        emit({ type: 'error', message: text });
        await this.conversations.save(conversation);
        return used;
      }

      if (message.stop_reason === 'refusal') {
        // Every model in the fallback chain declined. Don't keep the partial turn.
        const text = 'I can’t help with that request.';
        conversation.transcript.push({ type: 'error', text, at: now() });
        emit({ type: 'error', message: text });
        await this.conversations.save(conversation);
        return used;
      }

      const content = echoable(message.content);
      conversation.messages.push({
        role: 'assistant',
        content: content as Anthropic.Beta.BetaContentBlockParam[],
      });
      const toolUses = content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (answer.text.trim()) conversation.transcript.push(answer);

      if (toolUses.length === 0) {
        await this.conversations.save(conversation);
        return used;
      }

      // Tool input cut off at max_tokens: don't run it; answer every call so the history stays valid.
      if (message.stop_reason === 'max_tokens') {
        conversation.messages.push({
          role: 'user',
          content: toolUses.map((t) => ({
            type: 'tool_result' as const,
            tool_use_id: t.id,
            is_error: true,
            content: 'Your output was cut off before this call was complete; it was not run.',
          })),
        });
        const text = 'The answer was too long and got cut off. Try asking for less at once.';
        conversation.transcript.push({ type: 'error', text, at: now() });
        emit({ type: 'error', message: text });
        await this.conversations.save(conversation);
        return used;
      }

      const readResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const writes: PendingTurn['writes'] = [];
      const actions: PendingTurn['actions'] = [];
      const touched: AgentRecordRef[] = [];
      for (const call of toolUses) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        const activity = (ACTIVITY[call.name] ?? (() => `Using ${call.name}…`))(input);
        emit({ type: 'activity', text: activity });
        if (WRITE_TOOLS.has(call.name)) {
          const { action, error } = await this.tools.propose(
            ctx,
            call.id,
            call.name as ToolName,
            input,
          );
          if (action) {
            writes.push({ toolUseId: call.id, name: call.name, input });
            actions.push(action);
          } else {
            readResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              is_error: true,
              content: error!.content,
            });
          }
          continue;
        }
        const outcome = await this.tools.runRead(ctx, call.name as ToolName, input);
        touched.push(...outcome.records);
        readResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      if (touched.length) {
        const records = uniqueRecords(touched).slice(0, 12);
        // Records used are shown with the next answer.
        conversation.transcript.push({
          type: 'activity',
          text: `Looked at ${touched.length} record${touched.length === 1 ? '' : 's'}`,
          at: now(),
        });
        emit({ type: 'records', records });
        used.push(...records);
      }

      if (writes.length) {
        const proposalId = randomUUID();
        conversation.pending = {
          proposalId,
          toolUseIds: toolUses.map((t) => t.id),
          readResults,
          writes,
          actions,
        };
        conversation.transcript.push({ type: 'proposal', id: proposalId, actions, at: now() });
        emit({ type: 'proposal', id: proposalId, actions });
        await this.conversations.save(conversation);
        return used;
      }

      conversation.messages.push({ role: 'user', content: readResults });
      await this.conversations.save(conversation);
    }
    const text = `I stopped after ${MAX_TURNS} steps. Try a more specific question.`;
    conversation.transcript.push({ type: 'error', text, at: now() });
    emit({ type: 'error', message: text });
    await this.conversations.save(conversation);
    return used;
  }

  /** Runs a turn reserved by prepareTurn, then lists the records used under the last answer. */
  private async exclusive(
    conversation: AgentConversationEntity,
    emit: Emit,
    fn: () => Promise<AgentRecordRef[]>,
  ) {
    try {
      const used = await fn();
      const lastAnswer = [...conversation.transcript]
        .reverse()
        .find((t): t is Extract<TranscriptItem, { type: 'assistant' }> => t.type === 'assistant');
      if (used.length && lastAnswer) {
        lastAnswer.records = uniqueRecords([...lastAnswer.records, ...used]).slice(0, 12);
        await this.conversations.save(conversation);
      }
    } catch (err) {
      this.logger.error(
        `Agent turn failed in conversation ${conversation.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      emit({ type: 'error', message: 'Something went wrong while answering. Please try again.' });
    } finally {
      await this.redis.del(busyKey(conversation.id));
      emit({ type: 'done', conversation: toDto(conversation) });
    }
  }

  /** Per-user limit on assistant requests (shared across API instances via Redis). */
  private async rateLimit(userId: string) {
    const key = `agent-rate:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 70);
    if (count > loadEnv().AGENT_RATE_LIMIT) {
      throw new HttpException(
        'You’re sending messages too quickly. Please wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async find(ctx: AgentContext, id: string): Promise<AgentConversationEntity> {
    const conversation = isUuid(id)
      ? await this.conversations.findOneBy({
          id,
          workspaceId: ctx.workspace.id,
          userId: ctx.userId,
        })
      : null;
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}

function toDto(c: AgentConversationEntity): AgentConversationDto {
  return {
    id: c.id,
    title: c.title,
    transcript: c.transcript,
    awaitingApproval: Boolean(c.pending),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
