import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FrameType,
  OPEN_KIND,
  decodeFrames,
  decodeOpenMeta,
  encodeFrame,
  encodeOpen,
} from '@ccferry/protocol/src/frame';
import { TunnelServer } from './server';
import { StreamRouter } from './stream-router';

let app: ReturnType<typeof Fastify>;
let tunnel: TunnelServer;
let router: StreamRouter;
let port: number;
let pc: WebSocket;

beforeEach(async () => {
  tunnel = new TunnelServer({ tunnelToken: 't' });
  router = new StreamRouter({ tunnel, requestTimeoutMs: 2000 });
  app = Fastify();
  await app.register(websocket);
  tunnel.attach(app);
  router.register(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as { port: number }).port;
  // Fake PC peer: authenticate.
  pc = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
  await new Promise((resolve) => pc.on('open', resolve));
  pc.send(encodeFrame(FrameType.Auth, 0, Buffer.from('t')));
  await new Promise<void>((resolve) =>
    pc.once('message', (d) => {
      if (decodeFrames(Buffer.from(d as Buffer)).frames[0]!.type === FrameType.AuthOk) resolve();
    }),
  );
});

afterEach(async () => {
  pc.close();
  // An aborted mid-body fetch leaves its connection lingering in the server
  // (response never ended); drop it so close() does not wait forever.
  app.server.closeAllConnections();
  await app.close();
});

function servePcResponse(
  handler: (open: { streamId: number; meta: Record<string, unknown> }, reply: (frame: Buffer) => void) => void,
): void {
  pc.on('message', (data) => {
    for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
      if (frame.type === FrameType.Open) {
        const { kind, meta } = decodeOpenMeta(frame.payload);
        void kind;
        handler({ streamId: frame.streamId, meta }, (replyFrame) => pc.send(replyFrame));
      }
    }
  });
}

describe('StreamRouter (Review Focus 2, 3)', () => {
  it('maps a phone request through the tunnel and back', async () => {
    servePcResponse(({ streamId, meta }, reply) => {
      expect(meta['path']).toBe('/api/projects');
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' } }))));
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from('{"projects":[]}')));
      reply(encodeFrame(FrameType.Close, streamId, Buffer.from([0, 0])));
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"projects":[]}');
  });

  it('streams SSE chunk-by-chunk without waiting for CLOSE (Review Focus 3)', async () => {
    const instance = Fastify();
    await instance.register(websocket);
    const t2 = new TunnelServer({ tunnelToken: 't' });
    const r2 = new StreamRouter({ tunnel: t2 });
    t2.attach(instance);
    r2.register(instance);
    await instance.listen({ port: 0, host: '127.0.0.1' });
    const p2 = (instance.server.address() as { port: number }).port;
    const pc2 = new WebSocket(`ws://127.0.0.1:${p2}/tunnel`);
    await new Promise((resolve) => pc2.on('open', resolve));
    pc2.send(encodeFrame(FrameType.Auth, 0, Buffer.from('t')));
    await new Promise<void>((resolve) => pc2.once('message', () => resolve()));
    pc2.on('message', (data) => {
      for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
        if (frame.type === FrameType.Open) {
          pc2.send(encodeFrame(FrameType.Data, frame.streamId, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/event-stream' } }))));
          pc2.send(encodeFrame(FrameType.Data, frame.streamId, Buffer.from('data: early\n\n')));
        }
      }
    });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${p2}/api/anything`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const flushedEarly = new TextDecoder().decode(value ?? new Uint8Array()).includes('early');
    controller.abort();
    pc2.close();
    await instance.close();
    expect(flushedEarly).toBe(true);
  });

  it('answers 502 immediately when the tunnel is down (Review Focus 2)', async () => {
    pc.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'tunnel_down' });
  });

  it('answers 502 when the PC side reports an error close', async () => {
    servePcResponse(({ streamId }, reply) => {
      reply(encodeFrame(FrameType.Close, streamId, Buffer.from([0, 1])));
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(502);
  });

  it('times out stalled streams', async () => {
    servePcResponse(() => undefined); // PC never replies
    const res = await app.inject({ method: 'GET', url: '/api/slow' });
    expect(res.statusCode).toBe(502);
  });

  it('keeps a slow but active stream alive past the idle timeout', async () => {
    // A resumed session's first byte can exceed the timeout while streaming
    // fine — DATA activity must reset the idle timer (fix-forward #2).
    const instance = Fastify();
    await instance.register(websocket);
    const t2 = new TunnelServer({ tunnelToken: 't' });
    const r2 = new StreamRouter({ tunnel: t2, requestTimeoutMs: 300 });
    t2.attach(instance);
    r2.register(instance);
    await instance.listen({ port: 0, host: '127.0.0.1' });
    const p2 = (instance.server.address() as { port: number }).port;
    const pc2 = new WebSocket(`ws://127.0.0.1:${p2}/tunnel`);
    await new Promise((resolve) => pc2.on('open', resolve));
    pc2.send(encodeFrame(FrameType.Auth, 0, Buffer.from('t')));
    await new Promise<void>((resolve) => pc2.once('message', () => resolve()));
    pc2.on('message', (data) => {
      for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
        if (frame.type !== FrameType.Open) continue;
        pc2.send(encodeFrame(FrameType.Data, frame.streamId, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/event-stream' } }))));
        let ticks = 0;
        const iv = setInterval(() => {
          ticks += 1;
          if (ticks >= 6) {
            clearInterval(iv);
            pc2.send(encodeFrame(FrameType.Close, frame.streamId, Buffer.from([0, 0])));
            return;
          }
          pc2.send(encodeFrame(FrameType.Data, frame.streamId, Buffer.from('data: tick\n\n')));
        }, 100); // 600ms total — double the 300ms timeout
      }
    });
    const res = await instance.inject({ method: 'GET', url: '/api/slow' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('tick');
    pc2.close();
    await instance.close();
  });

  it('fails in-flight requests immediately when the tunnel drops', async () => {
    let sawOpen: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => (sawOpen = resolve));
    servePcResponse(() => sawOpen()); // PC takes the OPEN but never replies
    const started = Date.now();
    const resPromise = app.inject({ method: 'GET', url: '/api/slow' });
    await opened;
    pc.close(); // tunnel drops mid-request
    const res = await resPromise;
    expect(Date.now() - started).toBeLessThan(1500); // far below the 2000ms idle timeout
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'tunnel_down' });
  });

  it('destroys in-flight streamed responses when the tunnel drops', async () => {
    servePcResponse(({ streamId }, reply) => {
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/event-stream' } }))));
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from('data: one\n\n')));
    });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/sse`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read(); // headers + first chunk delivered — headersSent is true
    const settled = reader.read().then(
      () => undefined,
      () => undefined, // clean end or stream error — both stop the hang
    );
    pc.close();
    const started = Date.now();
    await settled;
    expect(Date.now() - started).toBeLessThan(1500); // not the 2000ms idle timeout
    controller.abort();
  });

  it('sends CLOSE for the stream when the phone disconnects mid-stream', async () => {
    let openStreamId = 0;
    servePcResponse(({ streamId }, reply) => {
      openStreamId = streamId;
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/event-stream' } }))));
      reply(encodeFrame(FrameType.Data, streamId, Buffer.from('data: one\n\n')));
      // stream intentionally left open
    });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/sse`, { signal: controller.signal });
    await response.body!.getReader().read();
    const closedAtPc = new Promise<number>((resolve) => {
      pc.on('message', (data) => {
        for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
          if (frame.type === FrameType.Close) resolve(frame.streamId);
        }
      });
    });
    controller.abort(); // the phone walks away
    expect(await closedAtPc).toBe(openStreamId);
  });
});
