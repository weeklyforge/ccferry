import { describe, expect, it } from 'vitest';
import { EventBuffer } from '../events/buffer';
import { SubscriptionStore, type PushSubscription } from './store';
import { attachPushSender, sendTestPush } from './sender';

function makeStore(): SubscriptionStore {
  const store = new SubscriptionStore(null);
  const sub: PushSubscription = { clientId: 'phone', endpoint: 'https://e', keys: { p256dh: 'k', auth: 'a' }, createdAt: 0 };
  void store.add(sub);
  return store;
}

function harness(store: SubscriptionStore, isForeground: (clientId: string) => boolean = () => false) {
  const buffer = new EventBuffer();
  const sent: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const sendFailures: Array<{ endpoint: string; status: number }> = [];
  attachPushSender(buffer, {
    store,
    isForeground,
    send: async (sub, payload) => {
      const failure = sendFailures.find((f) => f.endpoint === sub.endpoint);
      if (failure) {
        const error = new Error('push failed') as Error & { statusCode?: number };
        error.statusCode = failure.status;
        throw error;
      }
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
    },
  });
  return { buffer, sent, sendFailures };
}

describe('attachPushSender', () => {
  it('pushes approval and result events, skips settled/tunnel', async () => {
    const { buffer, sent } = harness(makeStore());
    buffer.push({ kind: 'approval', request: { approvalId: 'a1', sessionId: null, toolName: 'Bash', input: {}, createdAtMs: 0, timeoutMs: 60000 } });
    buffer.push({ kind: 'result', sessionId: 's1', ok: true, excerpt: 'done', at: 0 });
    buffer.push({ kind: 'tunnel', state: 'connected' });
    buffer.push({ kind: 'settled', approvalId: 'a1', decision: 'allow' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.payload).toMatchObject({ title: expect.stringContaining('Bash') });
    expect(sent[1]!.payload).toMatchObject({ title: expect.stringContaining('完成'), sessionId: 's1' });
  });

  it('pushes errors with a distinct title', async () => {
    const { buffer, sent } = harness(makeStore());
    buffer.push({ kind: 'result', sessionId: 's2', ok: false, excerpt: 'boom', at: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent[0]!.payload.title).toContain('出错');
  });

  it('suppresses push while the clientId has a live SSE', async () => {
    const { buffer, sent } = harness(makeStore(), (id) => id === 'phone');
    buffer.push({ kind: 'result', sessionId: 's3', ok: true, excerpt: 'x', at: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });

  it('does not re-push a replayed approval within the dedup window', async () => {
    const { buffer, sent } = harness(makeStore());
    const event = { kind: 'approval', request: { approvalId: 'dup', sessionId: null, toolName: 'Edit', input: {}, createdAtMs: 0, timeoutMs: 60000 } };
    buffer.push(event);
    buffer.push(event); // snapshot replay after reconnect
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });

  it('removes the subscription on a 410 and keeps others on transient errors', async () => {
    const store = new SubscriptionStore(null);
    await store.add({ clientId: 'gone', endpoint: 'https://gone', keys: { p256dh: 'k', auth: 'a' }, createdAt: 0 });
    await store.add({ clientId: 'ok', endpoint: 'https://ok', keys: { p256dh: 'k', auth: 'a' }, createdAt: 0 });
    const h = harness(store);
    h.sendFailures.push({ endpoint: 'https://gone', status: 410 }, { endpoint: 'https://ok', status: 500 });
    h.buffer.push({ kind: 'result', sessionId: 's', ok: true, excerpt: 'x', at: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect(store.list().map((s) => s.endpoint)).toEqual(['https://ok']);
  });
});

describe('sendTestPush', () => {
  it('sends a test notification through the same path', async () => {
    const { buffer, sent } = harness(makeStore());
    await sendTestPush(buffer);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent[0]!.payload.title).toContain('测试');
  });

  it('bypasses foreground suppression so the test button always fires', async () => {
    // The page sending the test is open by definition — suppression would
    // swallow every test push (owner hit this on desktop).
    const { buffer, sent } = harness(makeStore(), () => true);
    await sendTestPush(buffer);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });
});
