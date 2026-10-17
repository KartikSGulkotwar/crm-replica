export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

/** Fetches JSON from the API (same origin; cookies included). Non-2xx responses throw ApiError. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const message =
      (body as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
