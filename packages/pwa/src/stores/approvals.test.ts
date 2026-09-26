import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolApprovalRequest } from '@ccferry/protocol';
import { useApprovalsStore } from './approvals';

function request(id: string, ageMs = 0): ToolApprovalRequest {
  return {
    approvalId: id,
    sessionId: 's1',
    toolName: 'Bash',
    input: {},
    createdAtMs: Date.now() - ageMs,
    timeoutMs: 60000,
  };
}

describe('approvals store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('ingests without duplicating and decide removes + posts', async () => {
    const store = useApprovalsStore();
    store.ingest(request('a1'));
    store.ingest(request('a1'));
    expect(store.pending).toHaveLength(1);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await store.decide('a1', 'allow');
    expect(store.pending).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/approvals/a1/decision');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
    vi.unstubAllGlobals();
  });

  it('sweepExpired drops timed-out approvals', () => {
    const store = useApprovalsStore();
    store.ingest(request('fresh'));
    store.ingest(request('stale', 120000));
    store.sweepExpired();
    expect(store.pending.map((p) => p.approvalId)).toEqual(['fresh']);
  });
});
