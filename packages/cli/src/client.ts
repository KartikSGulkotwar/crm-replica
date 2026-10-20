import type {
  AppManifest,
  ApplyResult,
  MetadataExport,
  SessionResponse,
  ViewDto,
  WorkflowDto,
} from '@crm-replica/shared';
import { AppConfig, CliError } from './config';

/** Talks to the CRM API with the workspace API key. */
export class CrmClient {
  constructor(private readonly config: AppConfig) {
    if (!config.apiKey) {
      throw new CliError(
        'No API key. Create one in Settings → API keys, then set CRM_API_KEY (or put it in the app’s .env).',
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    okStatuses: number[] = [],
  ): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.config.url}/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new CliError(
        `Can’t reach ${this.config.url} (${(error as Error).message}). Is the server running?`,
      );
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      const message = (parsed as { message?: unknown })?.message;
      if (res.status === 401)
        throw new CliError('The API key was rejected (wrong, revoked, or for another server).');
      if (res.status === 403) throw new CliError('This API key’s owner isn’t a workspace admin.');
      throw new CliError(
        `${method} ${path} failed (${res.status}): ${Array.isArray(message) ? message.join('; ') : String(message ?? text)}`,
      );
    }
    return { status: res.status, body: parsed as T };
  }

  async whoami(): Promise<SessionResponse> {
    return (await this.request<SessionResponse>('GET', '/auth/me')).body;
  }

  async export(): Promise<MetadataExport> {
    return (await this.request<MetadataExport>('GET', '/metadata/export')).body;
  }

  async workflows(): Promise<WorkflowDto[]> {
    return (await this.request<WorkflowDto[]>('GET', '/workflows')).body;
  }

  async views(objectPlural: string): Promise<ViewDto[]> {
    return (
      await this.request<ViewDto[]>('GET', `/views?object=${encodeURIComponent(objectPlural)}`)
    ).body;
  }

  /** Returns the plan; for a real push, a 409/400 still returns the plan with `applied: false`. */
  async apply(
    manifest: AppManifest,
    opts: { dryRun: boolean; allowDestructive?: boolean },
  ): Promise<{ result: ApplyResult; message?: string }> {
    const res = await this.request<
      ApplyResult | { message: string | string[]; result: ApplyResult }
    >(
      'POST',
      '/metadata/apply',
      { manifest, dryRun: opts.dryRun, allowDestructive: opts.allowDestructive ?? false },
      [400, 409],
    );
    if (res.status === 200) return { result: res.body as ApplyResult };
    const failed = res.body as { message: string | string[]; result?: ApplyResult };
    if (!failed.result)
      throw new CliError(
        Array.isArray(failed.message) ? failed.message.join('\n') : failed.message,
      );
    return {
      result: failed.result,
      message: Array.isArray(failed.message) ? failed.message.join('\n') : failed.message,
    };
  }
}
