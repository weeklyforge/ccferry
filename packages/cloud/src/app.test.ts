import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameType, encodeFrame } from '@ccferry/protocol/src/frame';
import { buildCloudApp } from './app';

let app: Awaited<ReturnType<typeof buildCloudApp>>;
let port: number;
let pwaDir: string;

beforeEach(async () => {
  pwaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-pwa-'));
  await fs.writeFile(path.join(pwaDir, 'index.html'), '<html>pwa</html>');
  app = await buildCloudApp({ tunnelToken: 'tt', phoneToken: 'pt', pwaDir });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as { port: number }).port;
});

afterEach(async () => {
  await app.close();
  await fs.rm(pwaDir, { recursive: true, force: true });
});

describe('cloud app', () => {
  it('serves the PWA shell without a token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('pwa');
  });

  it('guards /api with the phone token', async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/api/events/stream`);
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/events/stream?token=pt`);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-type')).toContain('text/event-stream');
    const reader = allowed.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value ?? new Uint8Array()).startsWith(':')).toBe(true);
    await reader.cancel().catch(() => undefined);
  });

  it('buffers events from the tunnel event stream and redelivers to late subscribers', async () => {
    const pc = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
    await new Promise((resolve) => pc.on('open', resolve));
    pc.send(encodeFrame(FrameType.Auth, 0, Buffer.from('tt')));
    await new Promise<void>((resolve) => pc.once('message', () => resolve()));
    pc.send(encodeFrame(FrameType.Data, 0x8000_0000, Buffer.from(JSON.stringify({ kind: 'tunnel', state: 'connected' }))));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream?token=pt`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let body = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value ?? new Uint8Array());
      if (body.includes('"kind":"tunnel"')) break; // SSE never ends — stop at the hit
    }
    await reader.cancel().catch(() => undefined);
    expect(body).toContain('"kind":"tunnel"');
    pc.close();
  });

  it('answers 502 on /api/* with no PC peer (catch-all intact)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects?token=pt`);
    expect(res.status).toBe(502);
  });

  // The SSE body never ends on its own — read until `pattern` lands and
  // return the transcript so far; vitest's per-test timeout fails a missing
  // pattern instead of the read hanging forever.
  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, body: string, pattern: string): Promise<string> {
    const decoder = new TextDecoder();
    for (;;) {
      if (body.includes(pattern)) return body;
      const { done, value } = await reader.read();
      if (done) return body;
      body += decoder.decode(value ?? new Uint8Array());
    }
  }

  it('tells new subscribers the current tunnel state when no peer ever connected', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream?token=pt`);
    const reader = res.body!.getReader();
    const body = await readUntil(reader, '', '"kind":"tunnel"');
    await reader.cancel().catch(() => undefined);
    expect(body).toContain('"state":"disconnected"');
  });

  it('pushes authoritative tunnel events as the peer comes and goes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream?token=pt`);
    const reader = res.body!.getReader();
    let body = await readUntil(reader, '', '"state":"disconnected"'); // synthetic current state — no peer yet

    const pc = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
    await new Promise((resolve) => pc.on('open', resolve));
    pc.send(encodeFrame(FrameType.Auth, 0, Buffer.from('tt')));
    await new Promise<void>((resolve) => pc.once('message', () => resolve()));
    body = await readUntil(reader, body, '"state":"connected"'); // peer up — cloud-side event

    pc.terminate(); // crash: the daemon never gets to send its own goodbye
    body = await readUntil(reader, body, '"state":"disconnected"');
    expect(body).toContain('"state":"connected"'); // the up event landed before the down
    await reader.cancel().catch(() => undefined);
    pc.close();
  });

  it('does not report the tunnel down when a second peer replaces the first', async () => {
    const pc1 = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
    await new Promise((resolve) => pc1.on('open', resolve));
    pc1.send(encodeFrame(FrameType.Auth, 0, Buffer.from('tt')));
    await new Promise<void>((resolve) => pc1.once('message', () => resolve()));

    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream?token=pt`);
    const reader = res.body!.getReader();

    const pc2 = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
    pc2.on('open', () => pc2.send(encodeFrame(FrameType.Auth, 0, Buffer.from('tt'))));
    await new Promise<number>((resolve) => pc1.on('close', (code) => resolve(code))); // pc1 kicked (4400)

    let body = await readUntil(reader, '', '"state":"connected"'); // pc2 up via the cloud push
    // Flush everything up to a deterministic marker before judging: a
    // spurious drop from pc1's kicked socket would land by then.
    pc2.send(encodeFrame(FrameType.Data, 0x8000_0000, Buffer.from(JSON.stringify({ kind: 'marker' }))));
    body = await readUntil(reader, body, '"kind":"marker"');
    await reader.cancel().catch(() => undefined);
    expect(body).not.toContain('"state":"disconnected"');
    pc2.close();
  });

  it('exposes push routes and reports unconfigured without VAPID', async () => {
    const key = await fetch(`http://127.0.0.1:${port}/api/push/key?token=pt`);
    expect(key.status).toBe(503); // vapid null → push not configured
    const test = await fetch(`http://127.0.0.1:${port}/api/push/test?token=pt`, { method: 'POST' });
    expect(test.status).toBe(503);
    const guarded = await fetch(`http://127.0.0.1:${port}/api/push/key`);
    expect(guarded.status).toBe(401); // still behind the phone token gate
  });
});
