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
});
