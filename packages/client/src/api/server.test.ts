import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@ccferry/protocol';
import { FakeDriver } from '../driver/fake-driver';
import { buildServer } from './server';

const NOW = Date.now();

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: '11111111-aaaa-4bbb-8ccc-000000000001',
    projectPath: 'D:\\work\\proj A',
    file: 'D:\\fake\\11111111-aaaa-4bbb-8ccc-000000000001.jsonl',
    sizeBytes: 100,
    lastModifiedMs: NOW - 10 * 60 * 1000,
    firstUserText: 'hello',
    ...overrides,
  };
}

describe('api server', () => {
  it('GET /api/projects returns project summaries', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: [{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }] });
  });

  it('GET /api/sessions returns session summaries', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]?.sessionId).toBe('11111111-aaaa-4bbb-8ccc-000000000001');
  });

  it('GET /api/sessions/:id/stream emits SSE data lines', async () => {
    const app = buildServer(
      new FakeDriver([], [], [{ ok: true, line: 1, json: { type: 'user' } }]),
    );
    const res = await app.inject({ method: 'GET', url: '/api/sessions/sid-1/stream?fromStart=true' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"ok":true,"line":1,"json":{"type":"user"}}');
  });

  it('POST messages returns 409 session_active for a recently modified session (Review Focus 3)', async () => {
    const app = buildServer(new FakeDriver([], [session({ lastModifiedMs: NOW - 1000 })]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'session_active' });
  });

  it('POST messages resumes and streams DriverEvents when idle', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('echo:hi');
  });

  it('POST messages with force bypasses the active guard', async () => {
    const app = buildServer(new FakeDriver([], [session({ lastModifiedMs: NOW - 1000 })]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi', force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('echo:hi');
  });

  it('POST messages returns 400 without text and 404 for unknown sessions', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const missing = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/sessions/does-not-exist/messages',
      payload: { text: 'hi' },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
