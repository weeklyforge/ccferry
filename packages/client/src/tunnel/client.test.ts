import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
