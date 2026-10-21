import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { FieldType } from '@crm-replica/shared';
import { LlmClient } from '../../llm/llm-client';
import { RecordContext, RecordsService } from '../../records/records.service';
import { WorkspaceModelService } from '../../records/workspace-model.service';
import { PermanentStepError, RetryableStepError } from './step-errors';

export interface AiStepInput {
  prompt: unknown;
  choices?: string[];
  output?: { object: string; recordId: unknown; field: string };
}

export interface AiStepResult {
  answer: string;
  /** Set when the answer was written to a record. */
  recordId?: string;
}

const SYSTEM = [
  'You are a step in a CRM workflow. Do exactly what the instructions ask, using only the data they contain.',
  'Your answer is stored as-is in a CRM field, so give just the answer: no preamble, no Markdown headings, no sign-off.',
].join(' ');

/** The AI workflow step: summarise, write or classify with Claude, optionally saving the answer to a field. */
@Injectable()
export class AiStepService {
  constructor(
    private readonly llm: LlmClient,
    private readonly records: RecordsService,
    private readonly models: WorkspaceModelService,
  ) {}

  async run(input: AiStepInput, ctx: RecordContext): Promise<AiStepResult> {
    if (!this.llm.isConfigured()) {
      throw new PermanentStepError(
        'AI isn’t set up: add ANTHROPIC_API_KEY to the server’s .env and restart it',
      );
    }
    const target = input.output ? await this.target(input.output, ctx) : null;
    const choices = input.choices ?? target?.choices;
    const prompt =
      typeof input.prompt === 'string' ? input.prompt : JSON.stringify(input.prompt, null, 2);
    if (!prompt.trim()) throw new PermanentStepError('The prompt is empty');

    const answer = await this.ask(prompt, choices);
    if (!target) return { answer };
    await this.records.update(ctx, target.plural, target.recordId, { [target.field]: answer });
    return { answer, recordId: target.recordId };
  }

  private async ask(prompt: string, choices: string[] | undefined): Promise<string> {
    const content = choices
      ? `${prompt}\n\nAnswer with exactly one of: ${choices.map((c) => JSON.stringify(c)).join(', ')}.`
      : prompt;
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.llm.create({
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                answer: choices ? { type: 'string', enum: choices } : { type: 'string' },
              },
              required: ['answer'],
              additionalProperties: false,
            },
          },
        },
      });
    } catch (error) {
      throw stepErrorFor(error);
    }
    if (message.stop_reason === 'refusal')
      throw new PermanentStepError('The AI declined to answer this prompt');
    if (message.stop_reason === 'max_tokens')
      throw new PermanentStepError('The AI’s answer was too long; ask for something shorter');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let answer: unknown;
    try {
      answer = (JSON.parse(text) as { answer?: unknown }).answer;
    } catch {
      throw new RetryableStepError('The AI’s answer couldn’t be read');
    }
    if (typeof answer !== 'string')
      throw new RetryableStepError('The AI’s answer couldn’t be read');
    answer = answer.trim();
    if (choices && !choices.includes(answer as string)) {
      throw new RetryableStepError(
        `The AI answered "${answer as string}", which isn’t one of the choices`,
      );
    }
    return answer as string;
  }

  /** Where the answer goes. A select field with no explicit choices classifies into its options. */
  private async target(output: NonNullable<AiStepInput['output']>, ctx: RecordContext) {
    if (typeof output.recordId !== 'string' || !output.recordId) {
      throw new PermanentStepError('The record to save the answer to is empty');
    }
    const model = await this.models.load(ctx.workspace);
    const object = model.objects.find(
      (o) => o.nameSingular === output.object || o.namePlural === output.object,
    );
    if (!object) throw new PermanentStepError(`Object "${output.object}" doesn’t exist`);
    const field = object.fields.find((f) => f.name === output.field && !f.system);
    if (!field || (field.type !== FieldType.TEXT && field.type !== FieldType.SELECT)) {
      throw new PermanentStepError(
        `${object.labelSingular} has no text or select field "${output.field}"`,
      );
    }
    return {
      plural: object.namePlural,
      recordId: output.recordId,
      field: field.name,
      choices:
        field.type === FieldType.SELECT ? (field.options ?? []).map((o) => o.value) : undefined,
    };
  }
}

/** API errors: bad requests won't fix themselves; rate limits, overload and network errors might. */
function stepErrorFor(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const retryable =
      !status || status === 408 || status === 409 || status === 429 || status >= 500;
    const message = `The AI service returned an error (${status || 'network'})`;
    return retryable ? new RetryableStepError(message) : new PermanentStepError(message);
  }
  return new RetryableStepError((error as Error)?.message ?? String(error));
}
