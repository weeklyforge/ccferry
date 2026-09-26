import { describe, expect, it } from 'vitest';
import type { ParsedLine, SessionSummary } from '@ccferry/protocol';
import { FakeDriver } from '../driver/fake-driver';
import { buildServer } from './server';

const NOW = Date.now();

class ThrowingStreamDriver extends FakeDriver {
  async *streamSession(): AsyncGenerator<ParsedLine> {
    yield { ok: true, line: 1, json: { type: 'user' } };
    throw new Error('stream boom');
  }
}

class ThrowingSendDriver extends FakeDriver {
  async *sendMessage(): AsyncGenerator<never> {
    throw new Error('send boom');
  }
}

class OptsCapturingDriver extends FakeDriver {
  lastOpts: { fromStart: boolean; fromByte?: number } | undefined;

  async *streamSession(_id: string, opts: { fromStart: boolean; fromByte?: number }): AsyncGenerator<ParsedLine> {
    this.lastOpts = opts;
    yield { ok: true, line: 1, json: { type: 'user' } };
  }
}

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
      new FakeDriver([], [session()], [{ ok: true, line: 1, json: { type: 'user' } }]),
    );
    const res = await app.inject({ method: 'GET', url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/stream?fromStart=true' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"ok":true,"line":1,"json":{"type":"user"}}');
  });

  it('GET /api/sessions/:id/stream returns 404 for unknown sessions', async () => {
    const app = buildServer(new FakeDriver([], [], [{ ok: true, line: 1, json: {} }]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/does-not-exist/stream' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'session not found' });
  });

  it('GET /api/sessions/:id/stream maps tailBytes to a fromByte offset', async () => {
    const driver = new OptsCapturingDriver([], [session({ sizeBytes: 10_000 })]);
    const app = buildServer(driver);
    await app.inject({ method: 'GET', url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/stream?fromStart=true&tailBytes=1024' });
    expect(driver.lastOpts?.fromByte).toBe(10_000 - 1024);
  });

  it('clamps the tail offset to 0 when the file is smaller than tailBytes', async () => {
    const driver = new OptsCapturingDriver([], [session({ sizeBytes: 100 })]);
    const app = buildServer(driver);
    await app.inject({ method: 'GET', url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/stream?fromStart=true&tailBytes=4096' });
    expect(driver.lastOpts?.fromByte).toBe(0);
  });

  it('omits fromByte when tailBytes is absent', async () => {
    const driver = new OptsCapturingDriver([], [session({ sizeBytes: 10_000 })]);
    const app = buildServer(driver);
    await app.inject({ method: 'GET', url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/stream?fromStart=true' });
    expect(driver.lastOpts?.fromByte).toBeUndefined();
  });

  it('GET /api/sessions/:id/stream surfaces a mid-stream driver error as an SSE comment', async () => {
    const app = buildServer(new ThrowingStreamDriver([], [session()]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/stream?fromStart=true' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"ok":true,"line":1,"json":{"type":"user"}}');
    expect(res.body).toContain(': ccferry error: stream boom');
  });

  it('POST messages surfaces a mid-stream driver error as an error event', async () => {
    const app = buildServer(new ThrowingSendDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"type":"error","message":"send boom"}');
  });

  it('POST messages returns 409 session_active for a recently modified session (red line guard)', async () => {
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

  it('POST /api/messages starts a new session and streams DriverEvents', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: { projectPath: 'D:\\work\\proj A', text: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('echo:hello');
    expect(res.body).toContain('"sessionId":"new-session"');
  });

  it('POST /api/messages validates the body', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\x' } });
    expect(res.statusCode).toBe(400);
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

  it('rejects /api without a token when one is configured', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const denied = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer s3cret' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('accepts ?token= for SSE-style requests', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret' });
    expect(res.statusCode).toBe(200);
  });

  it('relaxes the Host allowlist when a token is configured', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer s3cret', host: '192.168.1.5:8787' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests whose Host header is not a loopback name (DNS rebinding guard)', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]));
    const evil = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'evil.example.com:8787' },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json()).toEqual({ error: 'host not allowed' });
    const loopback = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: '127.0.0.1:8787' },
    });
    expect(loopback.statusCode).toBe(200);
  });
});
