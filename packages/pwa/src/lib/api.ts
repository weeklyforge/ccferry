import { useAuthStore } from '../stores/auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = useAuthStore();
  const headers = new Headers(init.headers);
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${auth.daemonBase}${path}`, { ...init, headers });
}

export function sseUrl(path: string): string {
  const auth = useAuthStore();
  const url = new URL(auth.daemonBase + path);
  if (auth.token) url.searchParams.set('token', auth.token);
  return url.toString();
}

// EventSource cannot POST; consume SSE-over-POST with a stream reader.
export async function readSsePost(path: string, body: unknown, onEvent: (data: string) => void): Promise<void> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const response = await fetch(auth.daemonBase + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      // non-JSON error body — keep the empty object
    }
    throw new ApiError(response.status, parsed);
  }
  if (!response.body) throw new ApiError(response.status, {});
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) onEvent(line.slice(6));
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
