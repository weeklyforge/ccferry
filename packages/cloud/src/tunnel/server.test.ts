import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameType, decodeFrames, encodeFrame } from '@ccferry/protocol/src/frame';
import { TunnelServer } from './server';

let app: ReturnType<typeof Fastify>;
let tunnel: TunnelServer;
let port: number;

beforeEach(async () => {
  tunnel = new TunnelServer({ tunnelToken: 'secret-token' });
  app = Fastify();
  await app.register(websocket);
  tunnel.attach(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as { port: number }).port;
});

afterEach(async () => {
  await app.close();
});

function connect(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
}

function nextFrame(ws: WebSocket): Promise<{ type: number; streamId: number; payload: Buffer }> {
  return new Promise((resolve) => {
    ws.once('message', (data: WebSocket.RawData) => {
      const { frames } = decodeFrames(Buffer.from(data as Buffer));
      resolve(frames[0]!);
    });
  });
}

describe('TunnelServer AUTH (Review Focus 1)', () => {
  it('accepts a correct token and answers AUTH_OK', async () => {
    const ws = connect();
    const framePromise = nextFrame(ws);
    ws.on('open', () => ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token'))));
    const frame = await framePromise;
    expect(frame.type).toBe(FrameType.AuthOk);
    expect(tunnel.connectedPeerCount()).toBe(1);
    ws.close();
  });

  it('closes the connection on a wrong token', async () => {
    const ws = connect();
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('open', () => ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('wrong'))));
    expect(await closed).toBe(4401);
    expect(tunnel.connectedPeerCount()).toBe(0);
  });

  it('bans an IP after 5 failed AUTHs for 10 minutes', async () => {
    for (let i = 0; i < 5; i++) {
      const ws = connect();
      const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
      ws.on('open', () => ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('wrong'))));
      await closed;
    }
    const ws = connect();
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('open', () => ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token'))));
    expect(await closed).toBe(4403); // banned — even the right token is refused
  });

  it('kicks the old peer when a second connection authenticates', async () => {
    const first = connect();
    await new Promise((resolve) => first.on('open', resolve));
    first.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token')));
    await nextFrame(first); // AUTH_OK
    const kicked = new Promise<number>((resolve) => first.on('close', (code) => resolve(code)));
    const second = connect();
    const ok = nextFrame(second);
    second.on('open', () => second.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token'))));
    expect((await ok).type).toBe(FrameType.AuthOk);
    expect(await kicked).toBe(4400);
    expect(tunnel.connectedPeerCount()).toBe(1);
    second.close();
  });

  it('answers PING with PONG', async () => {
    const ws = connect();
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token')));
    await nextFrame(ws); // AUTH_OK first — consume before listening for PONG
    const pong = nextFrame(ws);
    ws.send(encodeFrame(FrameType.Ping, 0, Buffer.alloc(0)));
    expect((await pong).type).toBe(FrameType.Pong);
    ws.close();
  });

  it('delivers post-AUTH frames to onFrame', async () => {
    const seen: number[] = [];
    tunnel.onFrame((frame) => seen.push(frame.type));
    const ws = connect();
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(encodeFrame(FrameType.Auth, 0, Buffer.from('secret-token')));
    await nextFrame(ws); // AUTH_OK
    ws.send(encodeFrame(FrameType.Data, 5, Buffer.from('payload')));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen).toContain(FrameType.Data);
    ws.close();
  });
});
