import type { EventBuffer } from '../events/buffer';
import type { PushSubscription, SubscriptionStore } from './store';

export interface PushPayload {
  title: string;
  body: string;
  sessionId?: string;
}

export interface PushSenderOptions {
  store: SubscriptionStore;
  send: (sub: PushSubscription, payload: string) => Promise<void>;
  isForeground: (clientId: string) => boolean;
  log?: (message: string) => void;
}

const DEDUP_WINDOW_MS = 10 * 60_000;

function payloadFor(event: Record<string, unknown>): PushPayload | null {
  if (event['kind'] === 'approval') {
    const request = event['request'] as { toolName?: string; approvalId?: string; sessionId?: string | null } | undefined;
    if (!request?.toolName || !request.approvalId) return null;
    return { title: `等待批准：${request.toolName}`, body: '点按打开处理', sessionId: request.sessionId ?? undefined };
  }
  if (event['kind'] === 'result') {
    const ok = event['ok'] === true;
    const title = typeof event['title'] === 'string' ? event['title'] : ok ? '任务完成' : '任务出错';
    return {
      title,
      body: String(event['excerpt'] ?? ''),
      sessionId: typeof event['sessionId'] === 'string' ? event['sessionId'] : undefined,
    };
  }
  return null;
}

export function attachPushSender(buffer: EventBuffer, opts: PushSenderOptions): void {
  const recentApprovals = new Map<string, number>();
  buffer.subscribe((event) => {
    const payload = payloadFor(event);
    if (!payload) return;
    if (event['kind'] === 'approval') {
      const approvalId = (event['request'] as { approvalId: string }).approvalId;
      const seen = recentApprovals.get(approvalId);
      if (seen && Date.now() - seen < DEDUP_WINDOW_MS) return; // snapshot replay
      recentApprovals.set(approvalId, Date.now());
      if (recentApprovals.size > 200) {
        for (const [id, at] of recentApprovals) {
          if (Date.now() - at >= DEDUP_WINDOW_MS) recentApprovals.delete(id);
        }
      }
    }
    void deliver(opts, payload).catch(() => undefined);
  });
}

// Rides the real buffer path so the settings-page test button exercises the
// exact delivery logic (suppression, dedup, 410 cleanup included).
export async function sendTestPush(buffer: EventBuffer): Promise<void> {
  buffer.push({ kind: 'result', sessionId: 'test', ok: true, excerpt: '这是一条测试推送', at: Date.now(), title: '测试推送' });
}

async function deliver(opts: PushSenderOptions, payload: PushPayload): Promise<void> {
  for (const sub of opts.store.list()) {
    if (opts.isForeground(sub.clientId)) continue;
    try {
      await opts.send(sub, JSON.stringify(payload));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 410) {
        await opts.store.remove(sub.endpoint); // subscription expired
        opts.log?.(`push subscription removed (410): ${sub.endpoint}`);
      } else {
        opts.log?.(`push send failed: ${String(error)}`); // transient — next event retries
      }
    }
  }
}
