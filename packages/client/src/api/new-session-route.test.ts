import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@ccferry/protocol';
import { FakeDriver } from '../driver/fake-driver';
import { buildServer } from './server';

const NOW = Date.now();

function driverWith(vaultSession: boolean): FakeDriver {
  const sessions: SessionSummary[] = vaultSession
    ? [{ sessionId: 'v1', projectPath: 'D:\\vault', file: 'x', sizeBytes: 1, lastModifiedMs: NOW, firstUserText: 'v' }]
    : [];
  return new FakeDriver([{ projectPath: 'D:\\known', sessionCount: 1 }], sessions);
}

describe('new-session boundary (spec D1/D10)', () => {
  it('accepts a known project path', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\known', text: 'hi' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('echo:hi');
  });

  it('accepts the configured vault root even with no vault session yet', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\vault', text: 'hi' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an unknown path with 403 unknown_project', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\elsewhere', text: 'hi' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'unknown_project' });
  });
});
