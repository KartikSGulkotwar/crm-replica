import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '../config/env';

export type TurnParams = Omit<
  Anthropic.Beta.MessageCreateParamsNonStreaming,
  'model' | 'betas' | 'fallbacks'
>;

/** Thrown when no ANTHROPIC_API_KEY is configured. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      'The AI features aren’t set up: add ANTHROPIC_API_KEY to the server’s .env and restart it.',
    );
  }
}

/**
 * The one place the app talks to Claude. Tests replace it with a scripted fake.
 * Every request opts into server-side refusal fallbacks: if the model's safety classifiers
 * decline, the API retries on Anthropic's recommended fallback model in the same call.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private client?: Anthropic;

  isConfigured(): boolean {
    return Boolean(loadEnv().ANTHROPIC_API_KEY);
  }

  get model(): string {
    return loadEnv().ANTHROPIC_MODEL;
  }

  private sdk(): Anthropic {
    const key = loadEnv().ANTHROPIC_API_KEY;
    if (!key) throw new LlmNotConfiguredError();
    this.client ??= new Anthropic({ apiKey: key });
    return this.client;
  }

  /** Streams one model turn, calling `onText` for each text delta; resolves with the full message. */
  async streamTurn(
    params: TurnParams,
    onText: (delta: string) => void,
  ): Promise<Anthropic.Beta.BetaMessage> {
    const stream = this.sdk().beta.messages.stream({
      ...params,
      model: this.model,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    stream.on('text', onText);
    const message = await stream.finalMessage();
    this.logUsage(message);
    return message;
  }

  /** One non-streaming request (short outputs, e.g. the workflow AI step). */
  async create(params: TurnParams): Promise<Anthropic.Beta.BetaMessage> {
    const message = await this.sdk().beta.messages.create({
      ...params,
      model: this.model,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    this.logUsage(message);
    return message;
  }

  private logUsage(message: Anthropic.Beta.BetaMessage) {
    const u = message.usage;
    this.logger.debug(
      `${message.model} stop=${message.stop_reason} in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0}`,
    );
  }
}
