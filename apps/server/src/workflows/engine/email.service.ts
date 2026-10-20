import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { PermanentStepError, RetryableStepError } from './step-errors';

export interface EmailResult {
  delivered: boolean;
  provider: 'resend' | 'log';
  id?: string;
  to: string[];
  subject: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends workflow emails via Resend, or just logs them when no RESEND_API_KEY is set (development). */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');

  async send(input: { to: string; subject: string; body: string }): Promise<EmailResult> {
    const to = input.to
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const bad = to.filter((t) => !EMAIL.test(t));
    if (!to.length || bad.length)
      throw new PermanentStepError(`Invalid recipient: ${bad.join(', ') || '(empty)'}`);
    const env = loadEnv();
    if (!env.RESEND_API_KEY) {
      this.logger.log(
        `(not sent, no RESEND_API_KEY) to=${to.join(', ')} subject="${input.subject}"\n${input.body}`,
      );
      return { delivered: false, provider: 'log', to, subject: input.subject };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: input.subject, text: input.body }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e: Error) => {
      throw new RetryableStepError(`Couldn’t reach the email provider: ${e.message}`);
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.status >= 500 || res.status === 429)
      throw new RetryableStepError(`Email provider error ${res.status}: ${body.message ?? ''}`);
    if (!res.ok)
      throw new PermanentStepError(`Email rejected (${res.status}): ${body.message ?? ''}`);
    return { delivered: true, provider: 'resend', id: body.id, to, subject: input.subject };
  }
}
