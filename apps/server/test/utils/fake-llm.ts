import type Anthropic from '@anthropic-ai/sdk';
import type { TurnParams } from '../../src/llm/llm-client';

type Message = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;
/** Answers one request. Gets a deep copy of what was sent. */
export type Script = (params: TurnParams) => Message | Promise<Message>;

let ids = 0;

export const text = (t: string): Block => ({ type: 'text', text: t, citations: null }) as Block;
export const toolUse = (name: string, input: unknown, id = `toolu_${++ids}`): Block =>
  ({ type: 'tool_use', id, name, input }) as Block;
export const message = (
  content: Block[],
  stop_reason: Message['stop_reason'] = content.some((b) => b.type === 'tool_use')
    ? 'tool_use'
    : 'end_turn',
): Message =>
  ({
    id: `msg_${++ids}`,
    type: 'message',
    role: 'assistant',
    model: 'fake-model',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as Message;

/**
 * Stands in for LlmClient: each request takes the next scripted answer. Every request is kept
 * (deep-copied, as it was at the time) so tests can check exactly what the model was sent.
 */
export class FakeLlm {
  configured = true;
  model = 'fake-model';
  calls: TurnParams[] = [];
  private queue: Script[] = [];

  isConfigured() {
    return this.configured;
  }

  /** Queues answers for the next requests. */
  script(...answers: (Script | Message)[]) {
    this.queue.push(...answers.map((a) => (typeof a === 'function' ? a : () => a)));
  }

  reset() {
    this.queue = [];
    this.calls = [];
    this.configured = true;
  }

  get pending() {
    return this.queue.length;
  }

  async streamTurn(params: TurnParams, onText: (delta: string) => void): Promise<Message> {
    const reply = await this.next(params);
    for (const block of reply.content) if (block.type === 'text') onText(block.text);
    return reply;
  }

  async create(params: TurnParams): Promise<Message> {
    return this.next(params);
  }

  private async next(params: TurnParams): Promise<Message> {
    const copy = structuredClone(params);
    this.calls.push(copy);
    const answer = this.queue.shift();
    if (!answer) throw new Error('FakeLlm: no scripted answer left');
    return answer(copy);
  }
}
