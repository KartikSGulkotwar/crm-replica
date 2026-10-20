import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { loadEnv } from '../../config/env';
import { PermanentStepError, RetryableStepError } from './step-errors';

const MAX_BODY = 10_000;

/** True for loopback, private, link-local (incl. cloud metadata 169.254.x) and similar addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

export interface HttpStepResult {
  status: number;
  body: unknown;
}

/**
 * Webhook / HTTP request step. Only http(s), 10 s timeout, and by default no requests to
 * private or internal addresses, so workflows can't be used to probe the server's network.
 * (DNS is checked before connecting; WORKFLOW_HTTP_ALLOW_PRIVATE=true lifts the block.)
 */
@Injectable()
export class HttpStepService {
  async request(input: {
    method: string;
    url: string;
    headers: Record<string, unknown>;
    body?: unknown;
  }): Promise<HttpStepResult> {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new PermanentStepError(`Not a valid URL: ${input.url}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new PermanentStepError('Only http and https URLs are allowed');
    if (!loadEnv().WORKFLOW_HTTP_ALLOW_PRIVATE) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host)
        ? [host]
        : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
      if (!addresses.length) throw new RetryableStepError(`Couldn’t resolve ${host}`);
      if (addresses.some(isPrivateAddress))
        throw new PermanentStepError('Requests to private or internal addresses are blocked');
    }
    const headers: Record<string, string> = Object.fromEntries(
      Object.entries(input.headers).map(([k, v]) => [k, String(v ?? '')]),
    );
    const hasBody = input.body !== undefined && input.body !== null && input.method !== 'GET';
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type'))
      headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, {
        method: input.method,
        headers,
        body: hasBody
          ? typeof input.body === 'string'
            ? input.body
            : JSON.stringify(input.body)
          : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new RetryableStepError(`Request failed: ${(error as Error).message}`);
    }
    const text = (await res.text()).slice(0, MAX_BODY);
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    if (res.status >= 500 || res.status === 429)
      throw new RetryableStepError(`Server answered ${res.status}`);
    if (res.status >= 400)
      throw new PermanentStepError(`Server answered ${res.status}: ${text.slice(0, 200)}`);
    return { status: res.status, body };
  }
}
