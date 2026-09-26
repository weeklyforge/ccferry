import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameType, decodeFrames } from '@ccferry/protocol/src/frame';
import { TunnelServer } from '../../../cloud/src/tunnel/server';
import { StreamRouter } from '../../../cloud/src/tunnel/stream-router';
import { TunnelClient } from './client';

let cloudApp: ReturnType<typeof Fastify>;
let cloudPort: number;
let client: TunnelClient;

beforeEach(async () => {
  const tunnel = new TunnelServer({ tunnelToken: 'tt' });
  const router = new StreamRouter({ tunnel, requestTimeoutMs: 5000 });
  cloudApp = Fastify();
  await cloudApp.register(websocket);
  tunnel.attach(cloudApp);
  router.register(cloudApp);
  await cloudApp.listen({ port: 0, host: '127.0.0.1' });
  cloudPort = (cloudApp.server.address() as { port: number }).port;
});

afterEach(async () => {
  client?.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await cloudApp.close();
});

function makeClient(overrides: Partial<ConstructorParameters<typeof TunnelClient>[0]> = {}): TunnelClient {
  return new TunnelClient({
    url: `ws://127.0.0.1:${cloudPort}/tunnel`,
    token: 'tt',
    targetBase: 'http://127.0.0.1:1',
    ...overrides,
  });
}

describe('TunnelClient (Review Focus 2, 3)', () => {
  it('authenticates and reports connected', async () => {
    client = makeClient();
    client.start();
    await client.waitForConnected();
    expect(client.isConnected()).toBe(true);
  });

  it('bridges an http OPEN to the target and back', async () => {
    const target = Fastify();
    target.get('/api/echo', async () => ({ echoed: true }));
    await target.listen({ port: 0, host: '127.0.0.1' });
    const targetPort = (target.server.address() as { port: number }).port;
    client = makeClient({ targetBase: `http://127.0.0.1:${targetPort}` });
    client.start();
    await client.waitForConnected();
    const res = await cloudApp.inject({ method: 'GET', url: '/api/echo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ echoed: true });
    await target.close();
  });

  it('streams SSE bodies chunk-by-chunk from the target', async () => {
    const target = Fastify();
    target.get('/api/sse', async (_req, reply) => {
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.write('data: one\n\n');
      await new Promise((resolve) => setTimeout(resolve, 120));
      reply.raw.write('data: two\n\n');
      reply.raw.end();
    });
    await target.listen({ port: 0, host: '127.0.0.1' });
    const targetPort = (target.server.address() as { port: number }).port;
    client = makeClient({ targetBase: `http://127.0.0.1:${targetPort}` });
    client.start();
    await client.waitForConnected();
    const res = await cloudApp.inject({ method: 'GET', url: '/api/sse' });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: one');
    expect(res.body).toContain('data: two');
    await target.close();
  });

  it('reports upstream errors as CLOSE(1) -> phone sees 502 (Review Focus 2)', async () => {
    client = makeClient({ targetBase: 'http://127.0.0.1:1' }); // nothing listens
    client.start();
    await client.waitForConnected();
    const res = await cloudApp.inject({ method: 'GET', url: '/api/whatever' });
    expect(res.statusCode).toBe(502);
  });
});

describe('TunnelClient event bridge (Review Focus 4)', () => {
  it('sends the pending snapshot and tunnel-connected on AUTH_OK, then forwards live broker frames', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fakeBrokerRaw = {
      listeners: new Set<(frame: unknown) => void>(),
      subscribe(listener: (frame: unknown) => void) {
        fakeBrokerRaw.listeners.add(listener);
        return () => fakeBrokerRaw.listeners.delete(listener);
      },
      listPending: () => [
        { approvalId: 'ap-1', sessionId: null, toolName: 'Bash', input: {}, createdAtMs: Date.now(), timeoutMs: 60000 },
      ],
    };
    const fakeBroker = fakeBrokerRaw as unknown as import('../approval/broker').ApprovalBroker;

    // Observe event frames with a raw authenticated peer on the same cloud.
    const observer = new WebSocket(`ws://127.0.0.1:${cloudPort}/tunnel`);
    await new Promise((resolve) => observer.on('open', resolve));
    const { encodeFrame } = await import('@ccferry/protocol/src/frame');
    observer.send(encodeFrame(0x01, 0, Buffer.from('tt')));
    await new Promise<void>((resolve) => observer.once('message', () => resolve()));
    observer.on('message', (data) => {
      for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
        if (frame.type === FrameType.Data && frame.streamId === 0x8000_0000) {
          seen.push(JSON.parse(frame.payload.toString('utf8')) as Record<string, unknown>);
        }
      }
    });
    // The fake PC peer above IS our client; but the observer took the peer
    // slot only if it authenticates second (kick rule). Order: client first.
    observer.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const observer2 = new WebSocket(`ws://127.0.0.1:${cloudPort}/tunnel`);
    await new Promise((resolve) => observer2.on('open', resolve));
    observer2.close();

    client = makeClient({ broker: fakeBroker });
    client.start();
    await client.waitForConnected();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const kinds = seen.map((event) => event['kind']);
    expect(kinds).toContain('approval');
    expect(kinds).toContain('tunnel');
    const approval = seen.find((event) => event['kind'] === 'approval') as { request: { approvalId: string } };
    expect(approval.request.approvalId).toBe('ap-1');
  });
});
