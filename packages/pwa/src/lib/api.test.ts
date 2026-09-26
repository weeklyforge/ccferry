import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiError, readSsePost } from './api';

const authState = { token: 't' };

vi.mock('../stores/auth', () => ({
  useAuthStore: () => authState,
}));

afterEach(() => vi.unstubAllGlobals());

describe('readSsePost error handling', () => {
  it('rejects with ApiError carrying status and parsed body for non-2xx', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'session_active', lastModifiedMs: 123 }), { status: 409 }),
    ));
    const promise = readSsePost('/api/x', {}, () => undefined);
    const caught = await promise.then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.body).toMatchObject({ error: 'session_active', lastModifiedMs: 123 });
  });
});
