import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../approval/broker';
import { registerApprovalRoutes } from './approval-routes';

function app(broker: ApprovalBroker) {
  const instance = Fastify();
  registerApprovalRoutes(instance, broker);
  return instance;
}

describe('approval routes', () => {
  it('GET /api/approvals lists pending requests', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: { command: 'ls' } });
    const res = await app(broker).inject({ method: 'GET', url: '/api/approvals' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ approvals: [{ toolName: 'Bash', sessionId: 's1' }] });
  });

  it('POST decision applies, then 409 on repeat (Review Focus 2)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: null, toolName: 'Write', input: {} });
    const [pending] = broker.listPending();
    const approvalId = pending!.approvalId;
    const instance = app(broker);
    const first = await instance.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      payload: { decision: 'allow' },
    });
    expect(first.statusCode).toBe(200);
    const second = await instance.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      payload: { decision: 'deny' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'already_decided' });
  });

  it('POST decision validates the decision value', async () => {
    const res = await app(new ApprovalBroker()).inject({
      method: 'POST',
      url: '/api/approvals/x/decision',
      payload: { decision: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('flushes the SSE headers immediately on connect even with no pending approvals', async () => {
    const broker = new ApprovalBroker();
    const instance = app(broker);
    await instance.listen({ port: 0, host: '127.0.0.1' });
    const address = instance.server.address() as { port: number };
    const controller = new AbortController();
    // With nothing pending the route writes no data for 15s (keepalive);
    // fetch() must still resolve headers at once.
    const response = await fetch(`http://127.0.0.1:${address.port}/api/approvals/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    controller.abort();
    expect(new TextDecoder().decode(value ?? new Uint8Array()).startsWith(':')).toBe(true);
    await instance.close();
  });

  it('stream redelivers the pending snapshot on reconnect (Review Focus 4)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: {} });
    const [pending] = broker.listPending();
    const approvalId = pending!.approvalId;
    const instance = app(broker);
    await instance.listen({ port: 0, host: '127.0.0.1' });
    const address = instance.server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;

    // light-my-request (inject) cannot resolve a never-ending SSE response,
    // so read the first frame off a real socket and abort.
    async function readFirstFrame(): Promise<string> {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/approvals/stream`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      controller.abort();
      return new TextDecoder().decode(value ?? new Uint8Array());
    }

    const first = await readFirstFrame();
    const second = await readFirstFrame();
    expect(first).toContain('"toolName":"Bash"');
    expect(second).toContain('"toolName":"Bash"'); // snapshot survives reconnect
    broker.decide(approvalId, 'deny'); // settle so timers can clear
    await instance.close();
  });
});
