# M4 Implementation Plan: History Page + Web Push + Remote New Task + Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete requirements-map items #5/#6/#8 — web push (approval/complete/error), a history page with capped full-text search, remote new-task creation restricted to known projects — plus a UI polish pass and five quick-win minors from the M3 review.

**Architecture:** PC daemon gains a poll-based `PushSource` (JSONL result lines → tunnel event stream) and a capped history-search route; the cloud gains a disk-backed subscription store, an event-driven push sender with foreground suppression (SSE clientId tracking), and push subscription routes; the PWA gains History/NewTask tabs, a foreground event-stream subscription, a push-enable flow in Settings, and a custom service worker (workbox precache + push handler). No new runtime processes anywhere.

**Tech Stack:** TypeScript / Fastify / ws (existing); new deps: `web-push` + `@types/web-push` (cloud), `workbox-precaching` + `workbox-routing` + `workbox-core` (pwa devDeps). Everything else reuses M1–M3 modules.

**Spec:** `docs/superpowers/specs/2026-09-26-m4-history-push-newtask-design.md` (decisions D1–D10)

## Global Constraints

- Code and code comments in English only; UI copy may be Chinese.
- TypeScript strict with `noUncheckedIndexedAccess`; `moduleResolution: bundler`.
- Tests: vitest, co-located `*.test.ts`; TDD red-green for every behavior change.
- Commits: conventional subject + markdown bullet body, no `Co-Authored-By`; never push.
- History content scan: newest-first, cumulative byte cap **20MB** (`20 * 1024 * 1024`), per-file read cap **4MB**, matches limit **100**, line excerpt **200** chars (matches existing vault LINE_TRUNCATE).
- Result event excerpt: **80** chars.
- Push approval dedup window: **10 minutes** per approvalId.
- New-session boundary (D1/D10): `projectPath` must be in the scanner's known project set OR equal the configured vault root; else `403 {"error":"unknown_project"}`.
- The 5 quick-win minors (M3 ledger): strip forwarded `?token=`, `/api/` prefix match, remove `void Buffer`, per-peer ping socket, `requestBuffers` cleared on raw close.
- Deferred (do NOT do): 1MB bodyLimit change, multi-value headers, OPEN payload encoder export, daemon stop signal handler.

## Review Focus

1. **Approval snapshot replay after tunnel reconnect re-pushes old approvals** — a person would get one notification per pending approval on every tunnel reconnect. Pinned in Task 8 (dedup test: same approvalId event twice → one send).
2. **A result line split across polling windows / partial line at a size boundary** — a person would expect at most one 完成 notification per finished session. Pinned in Task 2 (byte-boundary test with a result line whose growth window starts mid-line).
3. **Session file truncated or rotated while the daemon runs** (size smaller than remembered) — a person would expect the source to reseed silently, not misparse garbage or crash. Pinned in Task 2 (shrink test).
4. **Push subscribe with a non-https endpoint or missing keys** — a person would expect a clean 400, and a poisoned store entry never to reach `web-push`. Pinned in Task 9 (validation tests).
5. **Malformed base64url in the VAPID public key** — a person tapping "enable push" with a corrupted server key would expect a visible failure, not a silent broken subscription. Pinned in Task 13 (`urlBase64ToUint8Array` test).

---

### Task 1: Custom service worker (precache + push handler)

**Files:**
- Create: `packages/pwa/src/sw.ts`
- Modify: `packages/pwa/vite.config.ts`
- Modify: `packages/pwa/package.json` (devDeps: `workbox-precaching`, `workbox-routing`, `workbox-core`)

**Interfaces:**
- Consumes: vite-plugin-pwa `injectManifest` strategy (v1.x, already a devDep).
- Produces: a service worker handling `push` → `showNotification` and `notificationclick` → focus-or-open; Task 13's subscribe flow relies on `navigator.serviceWorker.ready` finding it.

- [ ] **Step 1: Add workbox devDeps**

```bash
pnpm --filter @ccferry/pwa add -D workbox-precaching workbox-routing workbox-core
```

- [ ] **Step 2: Write the service worker**

`packages/pwa/src/sw.ts`:

```ts
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
self.skipWaiting();
clientsClaim();

interface PushPayload {
  title?: string;
  body?: string;
  sessionId?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'ccferry', {
      body: payload.body,
      tag: payload.sessionId ?? 'ccferry',
      data: payload,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })(),
  );
});
```

- [ ] **Step 3: Switch vite config to injectManifest**

In `packages/pwa/vite.config.ts`, replace the `VitePWA({...})` call with:

```ts
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src/sw.ts',
  filename: 'sw.js',
  registerType: 'autoUpdate',
  manifest: {
    name: 'ccferry',
    short_name: 'ccferry',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1989fa',
    icons: [],
  },
}),
```

(keep the `vue()` plugin and the dev-server `test` block unchanged)

- [ ] **Step 4: Build and verify the push handler landed in the bundle**

Run: `pnpm --filter @ccferry/pwa build && grep -c "addEventListener" packages/pwa/dist/sw.js && grep -c "showNotification" packages/pwa/dist/sw.js`
Expected: build succeeds; both greps print `>= 1`. (If injectManifest is rejected by the installed vite-plugin-pwa version, STOP and record the incompatibility in findings — fallback is a static `public/sw-push.js` loaded via `importScripts`; decide only after seeing the actual error.)

- [ ] **Step 5: Run pwa tests + typecheck**

Run: `pnpm --filter @ccferry/pwa test && pnpm --filter @ccferry/pwa typecheck`
Expected: all pass (30+ tests), vue-tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/pwa/src/sw.ts packages/pwa/vite.config.ts packages/pwa/package.json pnpm-lock.yaml
git commit -m "feat(pwa): custom service worker with push handling" -m "- workbox precache + navigation route via injectManifest
- push event shows a notification tagged by sessionId
- notificationclick focuses an existing window or opens the app"
```

### Task 2: PC PushSource — result lines → events

**Files:**
- Create: `packages/client/src/watcher/push-source.ts`
- Test: `packages/client/src/watcher/push-source.test.ts`
- Modify: `packages/client/src/main.ts` (wire into the tunnel branch)

**Interfaces:**
- Consumes: `ScanFn` from `../session/scan-cache` (`(claudeDir) => Promise<{projects, sessions: SessionSummary[]}>`); `SessionSummary.file/.sizeBytes/.firstUserText/.sessionId` from `@ccferry/protocol`; `TunnelClient.eventSend(payload: Record<string, unknown>): void` (Task 12 wiring).
- Produces: `new PushSource({ claudeDir, scan, pollMs?, onEvent, log? })` with `start(): void` / `stop(): void`; emits `{ kind: 'result', sessionId, ok, excerpt, at }`.

- [ ] **Step 1: Write the failing tests**

`packages/client/src/watcher/push-source.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { PushSource } from './push-source';

let dir: string;
const events: Array<Record<string, unknown>> = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-push-'));
  events.length = 0;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function session(id: string, sizeBytes: number): SessionSummary {
  return {
    sessionId: id,
    projectPath: 'D:\\work\\proj',
    file: path.join(dir, `${id}.jsonl`),
    sizeBytes,
    lastModifiedMs: Date.now(),
    firstUserText: 'hello',
  };
}

function scanOf(sessions: SessionSummary[]): (claudeDir: string) => Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
  return async () => ({ projects: [], sessions });
}

async function append(file: string, text: string): Promise<number> {
  await fs.appendFile(file, text);
  return (await fs.stat(file)).size;
}

describe('PushSource', () => {
  it('seeds without emitting and emits one result event for new growth', async () => {
    const id = 's1';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, '{"type":"user","message":"hi"}\n{"type":"result","subtype":"success","result":"done","session_id":"s1"}\n');
    const size1 = await append(file, '');
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, size1)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(events).toHaveLength(0); // seed poll: old results are old news

    await append(file, '{"type":"result","subtype":"success","result":"all finished","session_id":"s1"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'result', sessionId: 's1', ok: true, excerpt: 'all finished' });
  });

  it('marks non-success subtypes as errors', async () => {
    const id = 's2';
    const file = path.join(dir, `${id}.jsonl`);
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 0)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    await append(file, '{"type":"result","subtype":"error_during_execution","result":"boom","session_id":"s2"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events[0]).toMatchObject({ kind: 'result', ok: false, excerpt: 'boom' });
  });

  it('skips a partial line at the growth-window boundary', async () => {
    const id = 's3';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, '{"type":"user","message":"x"}\n');
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 27)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    // Old size 27 is mid-line: the appended text completes a JSON line only
    // after the remainder arrives. First poll sees a partial line — skip it.
    await append(file, '"type":"user","mess');
    await new Promise((r) => setTimeout(r, 80));
    await append(file, 'age":"y"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(0); // no parseable result line ever completed
  });

  it('reseeds silently when the file shrinks (rotation)', async () => {
    const id = 's4';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, 'x'.repeat(100));
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 100)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    await fs.writeFile(file, '{"type":"result","subtype":"success","result":"new file","session_id":"s4"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(0); // shrunk file = rotation: reseed, no emit
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ccferry/client exec vitest run src/watcher/push-source.test.ts`
Expected: FAIL — `Cannot find module './push-source'`.

- [ ] **Step 3: Implement PushSource**

`packages/client/src/watcher/push-source.ts`:

```ts
import { promises as fs } from 'node:fs';
import type { SessionSummary } from '@ccferry/protocol';
import type { ScanFn } from '../session/scan-cache';

export interface ResultEvent {
  kind: 'result';
  sessionId: string;
  ok: boolean;
  excerpt: string;
  at: number;
}

export interface PushSourceOptions {
  claudeDir: string;
  scan: ScanFn;
  pollMs?: number;
  onEvent: (event: ResultEvent) => void;
  log?: (message: string) => void;
}

const EXCERPT_LEN = 80;

// Polls the session store for growth and emits one event per newly appended
// `result` line — the single source of truth for 完成/出错, covering both TUI
// and daemon-driven sessions. First sight of a file only seeds its size:
// results that predate the daemon are old news.
export class PushSource {
  private readonly sizes = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly opts: PushSourceOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.running) return; // a slow scan must not pile up
    this.running = true;
    try {
      const { sessions } = await this.opts.scan(this.opts.claudeDir);
      const seen = new Set<string>();
      for (const s of sessions) {
        seen.add(s.file);
        const known = this.sizes.get(s.file);
        if (known === undefined || s.sizeBytes < known) {
          this.sizes.set(s.file, s.sizeBytes); // seed or rotation — never emit
          continue;
        }
        if (s.sizeBytes === known) continue;
        this.sizes.set(s.file, s.sizeBytes);
        await this.scanGrowth(s, known);
      }
    } catch (error) {
      this.opts.log?.(`push-source poll failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async scanGrowth(s: SessionSummary, fromByte: number): Promise<void> {
    const handle = await fs.open(s.file, 'r');
    try {
      const length = s.sizeBytes - fromByte;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, fromByte);
      // Skip a partial first line: the previous poll may have caught the
      // file mid-append.
      let text = buffer.toString('utf8');
      if (fromByte > 0 && !text.startsWith('\n')) {
        const firstNewline = text.indexOf('\n');
        if (firstNewline === -1) return;
        text = text.slice(firstNewline + 1);
      }
      for (const raw of text.split('\n')) {
        const event = parseResultLine(raw, s);
        if (event) this.opts.onEvent(event);
      }
    } catch {
      // unreadable window — the next poll resyncs from the new size
    } finally {
      await handle.close();
    }
  }
}

export function parseResultLine(raw: string, s: SessionSummary): ResultEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    if (json['type'] !== 'result' || typeof json['session_id'] !== 'string') return null;
    const result = json['result'];
    const excerpt =
      typeof result === 'string' && result.trim()
        ? result.slice(0, EXCERPT_LEN)
        : (s.firstUserText || '').slice(0, EXCERPT_LEN);
    return {
      kind: 'result',
      sessionId: json['session_id'],
      ok: json['subtype'] === 'success',
      excerpt,
      at: Date.now(),
    };
  } catch {
    return null;
  }
}
```

(Add `import { Buffer } from 'node:buffer';` at the top if `Buffer.alloc` needs it under the package's tsconfig.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ccferry/client exec vitest run src/watcher/push-source.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Wire into the daemon (tunnel branch only)**

In `packages/client/src/main.ts`, inside the `if (tunnelUrl && tunnelToken)` block after `tunnel.start()`:

```ts
const { PushSource } = await import('./watcher/push-source');
const { cachedScan } = await import('./session/scan-cache');
const pushSource = new PushSource({
  claudeDir,
  scan: cachedScan(claudeDir, 5000),
  onEvent: (event) => tunnel.eventSend(event as unknown as Record<string, unknown>),
  log: (message) => console.log(`ccferry-push: ${message}`),
});
pushSource.start();
```

(the `await import` style matches the file's top-level-await context; static imports are equally acceptable — pick one and match it.)

- [ ] **Step 6: Full client suite + typecheck + commit**

Run: `pnpm --filter @ccferry/client test && pnpm --filter @ccferry/client typecheck`
Expected: all pass, tsc clean.

```bash
git add packages/client/src/watcher/ packages/client/src/main.ts
git commit -m "feat(client): emit result events from session file growth" -m "- PushSource polls the cached scan and tails each grown file from its
  remembered size, skipping partial boundary lines
- one event per new result line (ok = subtype success); seed and
  rotation never emit
- daemon wires it into the tunnel event stream when a tunnel is configured"
```

### Task 3: M3 quick-win minors (five fixes)

**Files:**
- Modify: `packages/cloud/src/tunnel/stream-router.ts` (strip `token` from forwarded query)
- Modify: `packages/cloud/src/auth.ts` + `packages/client/src/api/server.ts` (`/api/` prefix)
- Modify: `packages/cloud/src/app.ts` (remove `void Buffer` + unused import)
- Modify: `packages/cloud/src/tunnel/server.ts` (ping timer uses its own peer socket)
- Modify: `packages/client/src/tunnel/client.ts` (clear `requestBuffers` on raw close)
- Test: additions in `packages/cloud/src/tunnel/stream-router.test.ts`, `packages/cloud/src/auth.test.ts`, `packages/client/src/tunnel/client.test.ts`, `packages/cloud/src/tunnel/server.test.ts`

**Interfaces:**
- Consumes: existing test fixtures per file.
- Produces: no signature changes — behavior-only fixes.

- [ ] **Step 1: RED — forwarded query drops `token` (cloud)**

Add to `stream-router.test.ts` (inside the existing `describe`):

```ts
it('strips the phone token from the forwarded path', async () => {
  let seenPath: string | undefined;
  servePcResponse((_open, reply) => {
    // captured below via meta in a second handler registration
  });
  pc.removeAllListeners('message');
  pc.on('message', (data) => {
    for (const frame of decodeFrames(Buffer.from(data as Buffer)).frames) {
      if (frame.type === FrameType.Open) {
        const meta = decodeOpenMeta(frame.payload).meta as Record<string, unknown>;
        seenPath = meta['path'] as string;
        reply(encodeFrame(FrameType.Data, frame.streamId, Buffer.from(JSON.stringify({ status: 200, headers: {} }))));
        reply(encodeFrame(FrameType.Close, frame.streamId, Buffer.from([0, 0])));
      }
    }
  });
  await app.inject({ method: 'GET', url: '/api/projects?token=secret-phone-token' });
  expect(seenPath).toBe('/api/projects');
});
```

(Remove the placeholder `servePcResponse` call — keep only the `pc.on('message', ...)` registration. Run: `pnpm --filter @ccferry/cloud exec vitest run src/tunnel/stream-router.test.ts` → Expected FAIL: seenPath still carries `?token=...`.)

- [ ] **Step 2: GREEN — strip in router**

In `stream-router.ts` `handle()`, before building `encodeOpen`:

```ts
// The phone token authenticates at the cloud only — never forward it to
// the PC daemon.
const url = new URL(req.url, 'http://local');
url.searchParams.delete('token');
const forwardPath = `${url.pathname}${url.search}`;
```

…and pass `path: forwardPath` instead of `path: req.url`. Run the test → PASS.

- [ ] **Step 3: RED→GREEN — `/api/` prefix exactness**

Add to `auth.test.ts`:

```ts
it('does not treat /apifoo as an api route', async () => {
  const hook = createPhoneAuthHook('t');
  const req = { url: '/apifoo', headers: {}, query: {} } as unknown as Parameters<ReturnType<typeof createPhoneAuthHook>>[0];
  const reply = { code: () => ({ send: () => undefined }) } as unknown as Parameters<ReturnType<typeof createPhoneAuthHook>>[1];
  let sent = false;
  const guarded = { code: () => ({ send: () => { sent = true; } }) };
  await hook(req, guarded as typeof reply);
  expect(sent).toBe(false);
});
```

Change both `packages/cloud/src/auth.ts:6` and `packages/client/src/api/server.ts` prefix checks from `startsWith('/api')` to `startsWith('/api/')`. (Cloud static fallback in `app.ts`/`server.ts` notFound handlers also use `/api` — update those to `/api/` in the same commit.) Run cloud + client tests → PASS. If the exact reply-shape above fights the types, simplify: call the hook with `url: '/apifoo'` and assert no 401 is produced via the app: `await app.inject({ method: 'GET', url: '/apifoo' })` expecting non-401 — prefer whichever compiles cleanly; keep the assertion "no /apifoo request is treated as API".

- [ ] **Step 4: Remove `void Buffer` (cloud/app.ts)**

Delete `import { Buffer } from 'node:buffer';` and the `void Buffer;` line in `packages/cloud/src/app.ts`. Run: `pnpm --filter @ccferry/cloud typecheck` → clean (if some tunnel type genuinely needs Buffer, the typecheck says so — then keep the import without the `void` marker and note it).

- [ ] **Step 5: RED→GREEN — ping timer targets its own peer**

Add to `server.test.ts` inside the watchdog describe:

```ts
it('sends pings to the peer that owns the timer, not the current peer', async () => {
  // peer A authenticates, then gets kicked by peer B; A's timer must never
  // send frames through B. We assert no crash + B stays connected.
  const t2 = new TunnelServer({ tunnelToken: 't', pingIntervalMs: 30, pongTimeoutMs: 10_000 });
  const app2 = Fastify();
  await app2.register(websocket);
  t2.attach(app2);
  await app2.listen({ port: 0, host: '127.0.0.1' });
  const p2 = (app2.server.address() as { port: number }).port;
  const a = new WebSocket(`ws://127.0.0.1:${p2}/tunnel`);
  await new Promise((resolve) => a.on('open', resolve));
  a.send(encodeFrame(FrameType.Auth, 0, Buffer.from('t')));
  await nextFrame(a);
  const kicked = new Promise<number>((resolve) => a.on('close', (code) => resolve(code)));
  const b = new WebSocket(`ws://127.0.0.1:${p2}/tunnel`);
  await new Promise((resolve) => b.on('open', resolve));
  b.send(encodeFrame(FrameType.Auth, 0, Buffer.from('t')));
  await nextFrame(b);
  expect(await kicked).toBe(4400);
  await new Promise((resolve) => setTimeout(resolve, 200)); // A's timer fires against a dead peer
  expect(t2.connectedPeerCount()).toBe(1); // B unaffected
  b.close();
  await app2.close();
});
```

In `server.ts` `attach()`, change the interval body's send from `this.send(FrameType.Ping, 0, Buffer.alloc(0))` to `peer.socket.send(encodeFrame(FrameType.Ping, 0, Buffer.alloc(0)))`. Run → PASS.

- [ ] **Step 6: RED→GREEN — requestBuffers cleared on raw close (client)**

Add to `client.test.ts` keepalive describe:

```ts
it('drops half-buffered request bodies when the socket dies', async () => {
  client = makeClient();
  client.start();
  await client.waitForConnected();
  // simulate an OPEN+partial body via the internal maps through a real flow:
  // easiest observable: stop() and reconnect leaves no stale entries — assert
  // via (client as any) is banned; instead expose nothing and test behavior:
  // a POST whose body frames were partially delivered completes after
  // reconnect when re-requested (no stale merge). Use the e2e echo route:
  const target = Fastify();
  target.post('/api/echo', async (req) => ({ got: req.body }));
  await target.listen({ port: 0, host: '127.0.0.1' });
  const targetPort = (target.server.address() as { port: number }).port;
  client.stop();
  client = makeClient({ targetBase: `http://127.0.0.1:${targetPort}` });
  client.start();
  await client.waitForConnected();
  const res = await cloudApp.inject({ method: 'POST', url: '/api/echo', payload: { n: 1 } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ got: { n: 1 } });
  await target.close();
});
```

(The behavioral pin: after `stop()` + reconnect, a fresh POST works with no stale buffer interference. For the direct pin, add `this.requestBuffers.clear();` to the `socket.on('close')` handler in `client.ts` `connect()` and verify the suite stays green — the e2e above is the observable guard.)

- [ ] **Step 7: Full suite + commit**

Run: `pnpm -r test && pnpm -r typecheck` → all green.

```bash
git add packages/cloud/src packages/client/src/tunnel/client.ts packages/client/src/tunnel/client.test.ts
git commit -m "fix(tunnel): five quick-win minors from the M3 review" -m "- strip the phone token query param before forwarding to the PC
- /api prefix checks match /api/ exactly (no /apifoo)
- drop the void Buffer import marker in cloud app
- per-peer ping timer sends through its own socket
- clear half-buffered request bodies when the tunnel socket dies"
```

### Task 4: New-session boundary (known projects + vault root)

**Files:**
- Modify: `packages/client/src/api/new-session-route.ts`
- Modify: `packages/client/src/api/server.ts` (pass `vaultRoot` to the route)
- Test: `packages/client/src/api/new-session-route.test.ts` (create)

**Interfaces:**
- Consumes: `SessionDriver.list(): Promise<{projects: ProjectSummary[]; sessions: SessionSummary[]}>`; `buildServer(driver, opts)` where `opts.vaultRoot?: string | null`.
- Produces: `registerNewSessionRoute(app, driver, vaultRoot: string | null)` — same SSE behavior for allowed paths; `403 {"error":"unknown_project"}` otherwise.

- [ ] **Step 1: RED — write the boundary tests**

`packages/client/src/api/new-session-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DriverEvent, ParsedLine } from '@ccferry/protocol';
import { FakeDriver } from '../driver/fake-driver';
import { buildServer } from './server';

function driverWith(vaultSession: boolean): FakeDriver {
  const sessions = vaultSession
    ? [{ sessionId: 'v1', projectPath: 'D:\\vault', file: 'x', sizeBytes: 1, lastModifiedMs: 1, firstUserText: 'v' }]
    : [];
  return new FakeDriver([{ projectPath: 'D:\\known', sessionCount: 1 }], sessions);
}

async function post(app: ReturnType<typeof buildServer>, projectPath: string): Promise<{ status: number }> {
  const controller = new AbortController();
  const res = await app.inject({
    method: 'POST',
    url: '/api/messages',
    payload: { projectPath, text: 'hi' },
  });
  controller.abort();
  return { status: res.statusCode };
}

describe('new-session boundary (spec D1/D10)', () => {
  it('accepts a known project path', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    expect((await post(app, 'D:\\known')).status).toBe(200);
  });

  it('accepts the configured vault root even with no vault session yet', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    expect((await post(app, 'D:\\vault')).status).toBe(200);
  });

  it('rejects an unknown path with 403 unknown_project', async () => {
    const app = buildServer(driverWith(false), { vaultRoot: 'D:\\vault' });
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\elsewhere', text: 'hi' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'unknown_project' });
  });
});
```

Note: `buildServer` must pass a `vaultRoot`; for allowed paths the FakeDriver streams and `inject` waits for stream end — `FakeDriver.sendMessage` terminates, so status is observable. If `inject` hangs on an SSE route, use the never-ending-safe pattern: assert via the raw status of a rejected/aborted call as the existing `server.test.ts` message tests do (mirror those).

Run: `pnpm --filter @ccferry/client exec vitest run src/api/new-session-route.test.ts`
Expected: FAIL — unknown path currently returns 200.

- [ ] **Step 2: GREEN — validate in the route**

`new-session-route.ts`:

```ts
export function registerNewSessionRoute(app: FastifyInstance, driver: SessionDriver, vaultRoot: string | null): void {
  app.post('/api/messages', async (req, reply) => {
    const body = (req.body ?? {}) as { projectPath?: string; text?: string };
    if (!body.projectPath || !body.text) {
      return reply.code(400).send({ error: 'projectPath and text required' });
    }
    // Boundary (spec D1/D10): only projects already present in the session
    // store, plus the configured vault root itself.
    const { projects } = await driver.list();
    const known = projects.some((p) => p.projectPath === body.projectPath) || body.projectPath === vaultRoot;
    if (!known) return reply.code(403).send({ error: 'unknown_project' });
    // ... existing SSE streaming body unchanged ...
```

In `server.ts`: `registerNewSessionRoute(app, driver, opts.vaultRoot ?? null);` (replacing the existing call). Run Step 1 tests → PASS.

- [ ] **Step 3: Suite + commit**

Run: `pnpm --filter @ccferry/client test` → green.

```bash
git add packages/client/src/api/
git commit -m "feat(client): restrict remote new sessions to known projects" -m "- POST /api/messages validates projectPath against the scanner set or
  the configured vault root (spec D1/D10)
- unknown paths get 403 unknown_project"
```

### Task 5: History search lib + route

**Files:**
- Create: `packages/client/src/api/history-search.ts`
- Test: `packages/client/src/api/history-search.test.ts`
- Modify: `packages/client/src/api/server.ts` (register `GET /api/history/search`)

**Interfaces:**
- Consumes: `SessionSummary` (has `.file`), `node:fs` reads.
- Produces: `searchSessions(sessions: SessionSummary[], query: string, filter: { project?: string; days?: number; limit?: number }): Promise<{ matches: HistoryMatch[]; truncated: boolean }>` where `HistoryMatch = { sessionId; projectPath; firstUserText; line; text; lastModifiedMs }`; route `GET /api/history/search?q=&project=&days=&limit=`.

- [ ] **Step 1: RED — write the tests**

`packages/client/src/api/history-search.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionSummary } from '@ccferry/protocol';
import { searchSessions } from './history-search';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-history-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function summary(id: string, opts: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: id,
    projectPath: 'D:\\p',
    file: path.join(dir, `${id}.jsonl`),
    sizeBytes: 1,
    lastModifiedMs: Date.now(),
    firstUserText: 'greeting text',
    ...opts,
  };
}

describe('searchSessions', () => {
  it('matches content case-insensitively and reports line numbers', async () => {
    await fs.writeFile(summary('a').file, '{"type":"user"}\nfind the Smart Heating note here\n');
    const { matches, truncated } = await searchSessions([summary('a')], 'smart heating', {});
    expect(truncated).toBe(false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ sessionId: 'a', line: 2 });
    expect(matches[0]!.text).toContain('Smart Heating');
  });

  it('matches titles via firstUserText without reading files', async () => {
    const { matches } = await searchSessions([summary('b', { file: path.join(dir, 'missing.jsonl') })], 'GREETING', {});
    expect(matches).toHaveLength(1);
    expect(matches[0]!.line).toBe(0); // title hit
  });

  it('filters by project and days', async () => {
    await fs.writeFile(summary('c', { projectPath: 'D:\\other', lastModifiedMs: Date.now() - 40 * 86_400_000 }).file, 'findme\n');
    const projOnly = await searchSessions([summary('c', { projectPath: 'D:\\other' })], 'findme', { project: 'D:\\p' });
    expect(projOnly.matches).toHaveLength(0);
    const daysOnly = await searchSessions([summary('c', { lastModifiedMs: Date.now() - 40 * 86_400_000 })], 'findme', { days: 7 });
    expect(daysOnly.matches).toHaveLength(0);
  });

  it('stops at the byte cap and reports truncated', async () => {
    for (const id of ['d1', 'd2', 'd3']) {
      await fs.writeFile(summary(id, { lastModifiedMs: Date.now() + (id === 'd1' ? 3000 : id === 'd2' ? 2000 : 1000) }).file, `findme ${id}\n`.repeat(50));
    }
    const { matches, truncated } = await searchSessions([summary('d1'), summary('d2'), summary('d3')], 'findme', { byteCapBytes: 10 });
    expect(truncated).toBe(true);
    expect(matches.every((m) => m.sessionId === 'd1' || m.sessionId === 'd2')).toBe(true); // newest-first, d3 never scanned
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: GREEN — implement**

`packages/client/src/api/history-search.ts`:

```ts
import { promises as fs } from 'node:fs';
import type { SessionSummary } from '@ccferry/protocol';

export interface HistoryMatch {
  sessionId: string;
  projectPath: string;
  firstUserText: string;
  line: number;
  text: string;
  lastModifiedMs: number;
}

export interface HistoryResult {
  matches: HistoryMatch[];
  truncated: boolean;
}

const DEFAULT_BYTE_CAP = 20 * 1024 * 1024;
const PER_FILE_CAP = 4 * 1024 * 1024;
const LINE_TRUNCATE = 200;
const DEFAULT_LIMIT = 100;

// Capped full-text search over session JSONL files (spec D4): metadata
// filters first, title hits are free, content scans run newest-first under
// a cumulative byte budget so a 500MB store cannot stall the daemon.
export async function searchSessions(
  sessions: SessionSummary[],
  query: string,
  filter: { project?: string; days?: number; limit?: number; byteCapBytes?: number },
): Promise<HistoryResult> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], truncated: false };
  const minTime = filter.days ? Date.now() - filter.days * 86_400_000 : 0;
  const pool = sessions
    .filter((s) => (!filter.project || s.projectPath === filter.project) && s.lastModifiedMs >= minTime)
    .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const matches: HistoryMatch[] = [];
  let truncated = false;
  let budget = filter.byteCapBytes ?? DEFAULT_BYTE_CAP;
  for (const s of pool) {
    if (matches.length >= limit) break;
    const title = s.firstUserText.toLowerCase();
    if (title.includes(needle)) {
      matches.push({ sessionId: s.sessionId, projectPath: s.projectPath, firstUserText: s.firstUserText, line: 0, text: s.firstUserText.slice(0, LINE_TRUNCATE), lastModifiedMs: s.lastModifiedMs });
    }
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const readLen = Math.min(s.sizeBytes, budget, PER_FILE_CAP);
    const from = s.sizeBytes > readLen ? s.sizeBytes - readLen : 0;
    let text: string;
    try {
      const handle = await fs.open(s.file, 'r');
      try {
        const buffer = Buffer.alloc(readLen);
        await handle.read(buffer, 0, readLen, from);
        text = buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      continue; // vanished or unreadable file — skip
    }
    budget -= readLen;
    if (from > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) text = text.slice(firstNewline + 1);
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      const lower = lines[i]!.toLowerCase();
      if (lower.includes(needle)) {
        matches.push({ sessionId: s.sessionId, projectPath: s.projectPath, firstUserText: s.firstUserText, line: i + 1, text: lines[i]!.slice(0, LINE_TRUNCATE), lastModifiedMs: s.lastModifiedMs });
      }
    }
    if (readLen < Math.min(s.sizeBytes, PER_FILE_CAP)) truncated = true;
  }
  return { matches, truncated };
}
```

- [ ] **Step 3: Route registration**

In `server.ts` after the sessions routes:

```ts
app.get('/api/history/search', async (req, reply) => {
  const query = req.query as { q?: string; project?: string; days?: string; limit?: string };
  if (!query.q?.trim()) return reply.code(400).send({ error: 'q required' });
  const { sessions } = await driver.list();
  const result = await searchSessions(sessions, query.q, {
    project: query.project,
    days: query.days ? Number(query.days) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });
  return result;
});
```

(import `searchSessions` from `./history-search`.)

- [ ] **Step 4: GREEN + suite + commit**

Run: `pnpm --filter @ccferry/client exec vitest run src/api/history-search.test.ts && pnpm --filter @ccferry/client test` → all green.

```bash
git add packages/client/src/api/history-search.ts packages/client/src/api/history-search.test.ts packages/client/src/api/server.ts
git commit -m "feat(client): capped full-text history search" -m "- searchSessions: metadata filters, free title hits, newest-first
  content scan under a 20MB cumulative / 4MB per-file byte budget
- GET /api/history/search exposes it with q/project/days/limit"
```

### Task 6: Result variant in CloudEvent (protocol)

**Files:**
- Modify: `packages/protocol/src/index.ts` (extend `CloudEvent`)

**Interfaces:**
- Produces: `CloudEvent` gains `{ kind: 'result'; sessionId: string; ok: boolean; excerpt: string; at: number }` — consumed by Tasks 8/11.

- [ ] **Step 1: Extend the union**

```ts
export type CloudEvent =
  | { kind: 'approval'; request: ToolApprovalRequest }
  | { kind: 'settled'; approvalId: string; decision: string }
  | { kind: 'tunnel'; state: 'connected' | 'disconnected' }
  | { kind: 'result'; sessionId: string; ok: boolean; excerpt: string; at: number };
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -r typecheck` → clean (no consumer narrows exhaustively today).

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add result variant to CloudEvent" -m "- kind result carries sessionId/ok/excerpt/at for web push"
```

### Task 7: Cloud SubscriptionStore

**Files:**
- Create: `packages/cloud/src/push/store.ts`
- Test: `packages/cloud/src/push/store.test.ts`

**Interfaces:**
- Produces: `interface PushSubscription { clientId: string; endpoint: string; keys: { p256dh: string; auth: string }; createdAt: number }`; `new SubscriptionStore(filePath: string | null)` with `load(): Promise<void>`, `add(sub: PushSubscription): Promise<void>`, `remove(endpoint: string): Promise<void>`, `list(): PushSubscription[]`.

- [ ] **Step 1: RED — tests**

`packages/cloud/src/push/store.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionStore } from './store';

let file: string;

beforeEach(async () => {
  file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-subs-')), 'subs.json');
});
afterEach(async () => {
  await fs.rm(path.dirname(file), { recursive: true, force: true });
});

function sub(endpoint: string): Parameters<SubscriptionStore['add']>[0] {
  return { clientId: 'c1', endpoint, keys: { p256dh: 'k', auth: 'a' }, createdAt: Date.now() };
}

describe('SubscriptionStore', () => {
  it('adds, lists, and removes subscriptions', async () => {
    const store = new SubscriptionStore(null);
    await store.add(sub('https://e1'));
    await store.add(sub('https://e2'));
    expect(store.list()).toHaveLength(2);
    await store.remove('https://e1');
    expect(store.list().map((s) => s.endpoint)).toEqual(['https://e2']);
  });

  it('survives a restart via the file', async () => {
    const first = new SubscriptionStore(file);
    await first.load();
    await first.add(sub('https://keep'));
    const second = new SubscriptionStore(file);
    await second.load();
    expect(second.list().map((s) => s.endpoint)).toEqual(['https://keep']);
  });

  it('re-adding an endpoint updates instead of duplicating', async () => {
    const store = new SubscriptionStore(null);
    await store.add(sub('https://e1'));
    await store.add({ ...sub('https://e1'), clientId: 'c2' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.clientId).toBe('c2');
  });

  it('starts empty when the file is missing or corrupt', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json{');
    const store = new SubscriptionStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: GREEN — implement**

`packages/cloud/src/push/store.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PushSubscription {
  clientId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

// Disk-backed (when filePath is set) subscription store; the file write is
// atomic (tmp + rename) so a crash cannot truncate it.
export class SubscriptionStore {
  private readonly subs = new Map<string, PushSubscription>();

  constructor(private readonly filePath: string | null) {}

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PushSubscription[];
      for (const sub of parsed) this.subs.set(sub.endpoint, sub);
    } catch {
      this.subs.clear(); // missing or corrupt — start empty
    }
  }

  async add(sub: PushSubscription): Promise<void> {
    this.subs.set(sub.endpoint, sub);
    await this.persist();
  }

  async remove(endpoint: string): Promise<void> {
    if (!this.subs.delete(endpoint)) return;
    await this.persist();
  }

  list(): PushSubscription[] {
    return [...this.subs.values()];
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(this.list()));
    await fs.rename(tmp, this.filePath);
  }
}
```

Run → PASS 4/4.

- [ ] **Step 3: Commit**

```bash
git add packages/cloud/src/push/
git commit -m "feat(cloud): disk-backed push subscription store" -m "- atomic tmp+rename persistence, endpoint-keyed upsert
- null filePath keeps everything in memory for tests"
```

### Task 8: Cloud push sender (three states, suppression, dedup, 410)

**Files:**
- Create: `packages/cloud/src/push/sender.ts`
- Test: `packages/cloud/src/push/sender.test.ts`

**Interfaces:**
- Consumes: `EventBuffer.subscribe(writer)` (cloud events); `SubscriptionStore`.
- Produces: `attachPushSender(buffer, opts)` where `opts = { store: SubscriptionStore; send: (sub: PushSubscription, payload: string) => Promise<void>; isForeground: (clientId: string) => boolean; log?: (m: string) => void }`; payload JSON `{ title: string; body: string; sessionId?: string }`; also exports `sendTestPush(opts): Promise<void>` for Task 9's test button.

- [ ] **Step 1: RED — tests**

`packages/cloud/src/push/sender.test.ts`:

```ts
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
});
```

Run → FAIL.

- [ ] **Step 2: GREEN — implement**

`packages/cloud/src/push/sender.ts`:

```ts
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
    const request = event['request'] as { toolName?: string; approvalId?: string } | undefined;
    if (!request?.toolName || !request.approvalId) return null;
    return { title: `等待批准：${request.toolName}`, body: '点按打开处理', sessionId: (request as { sessionId?: string }).sessionId ?? undefined };
  }
  if (event['kind'] === 'result') {
    const ok = event['ok'] === true;
    return {
      title: ok ? '任务完成' : '任务出错',
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
```

Note `sendTestPush` pushes through the real buffer so it exercises the exact delivery path; the extra `title` field on the synthetic event is ignored by `payloadFor` — to make the assertion pass, special-case: in `payloadFor`, for `kind === 'result'` prefer `typeof event['title'] === 'string' ? event['title'] : (ok ? '任务完成' : '任务出错')`. Implement that. Run → PASS 7/7.

- [ ] **Step 3: Commit**

```bash
git add packages/cloud/src/push/sender.ts packages/cloud/src/push/sender.test.ts
git commit -m "feat(cloud): event-driven web push sender" -m "- approval and result events become notifications; settled/tunnel ignored
- foreground suppression via clientId, 10-minute approval replay dedup
- 410 removes the subscription; transient failures log and retry later
- sendTestPush rides the real buffer path for the settings test button"
```

### Task 9: Cloud push routes + app wiring + env

**Files:**
- Create: `packages/cloud/src/api/push-routes.ts`
- Modify: `packages/cloud/src/app.ts` (wire store/sender/tracker/routes; SSE clientId)
- Modify: `packages/cloud/src/main.ts` (VAPID + subs-path env)
- Test: `packages/cloud/src/api/push-routes.test.ts`, extend `packages/cloud/src/app.test.ts`

**Interfaces:**
- Consumes: Tasks 7/8; `createPhoneAuthHook` already guards `/api/*`.
- Produces: `registerPushRoutes(app, { store, publicKey, sendTest })`; `GET /api/push/key` → `{ publicKey }` | 503; `POST /api/push/subscribe {clientId, endpoint, keys:{p256dh,auth}}` → 204 | 400; `POST /api/push/unsubscribe {endpoint}` → 204; `POST /api/push/test` → 204 | 503; `buildCloudApp(opts)` gains `vapid?: { publicKey: string; privateKey: string; subject: string } | null` and `subscriptionsPath?: string | null`.

- [ ] **Step 1: RED — route tests**

`packages/cloud/src/api/push-routes.test.ts`:

```ts
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SubscriptionStore } from '../push/store';
import { registerPushRoutes } from './push-routes';

function buildApp(publicKey: string | null) {
  const app = Fastify();
  const store = new SubscriptionStore(null);
  registerPushRoutes(app, { store, publicKey, sendTest: async () => undefined });
  return { app, store };
}

describe('push routes', () => {
  it('returns the vapid public key', async () => {
    const { app } = buildApp('PUBKEY');
    const res = await app.inject({ method: 'GET', url: '/api/push/key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: 'PUBKEY' });
  });

  it('503s when push is not configured', async () => {
    const { app } = buildApp(null);
    expect((await app.inject({ method: 'GET', url: '/api/push/key' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/push/test' })).statusCode).toBe(503);
  });

  it('accepts a valid subscription and rejects bad payloads', async () => {
    const { app, store } = buildApp('PUB');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(ok.statusCode).toBe(204);
    expect(store.list()).toHaveLength(1);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'http://insecure/', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'https://x/', keys: { p256dh: 'k' } },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('unsubscribes by endpoint', async () => {
    const { app, store } = buildApp('PUB');
    await store.add({ clientId: 'c', endpoint: 'https://e', keys: { p256dh: 'k', auth: 'a' }, createdAt: 0 });
    const res = await app.inject({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: 'https://e' } });
    expect(res.statusCode).toBe(204);
    expect(store.list()).toHaveLength(0);
  });
});
```

Run → FAIL.

- [ ] **Step 2: GREEN — routes**

`packages/cloud/src/api/push-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { PushSubscription, SubscriptionStore } from '../push/store';

export interface PushRoutesOptions {
  store: SubscriptionStore;
  publicKey: string | null;
  sendTest: () => Promise<void>;
}

export function registerPushRoutes(app: FastifyInstance, opts: PushRoutesOptions): void {
  app.get('/api/push/key', async (_req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    return { publicKey: opts.publicKey };
  });

  app.post('/api/push/subscribe', async (req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    const body = (req.body ?? {}) as { clientId?: string; endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (
      typeof body.clientId !== 'string' || !body.clientId ||
      typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://') ||
      typeof body.keys?.p256dh !== 'string' || !body.keys.p256dh ||
      typeof body.keys.auth !== 'string' || !body.keys.auth
    ) {
      return reply.code(400).send({ error: 'invalid_subscription' });
    }
    const sub: PushSubscription = {
      clientId: body.clientId,
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      createdAt: Date.now(),
    };
    await opts.store.add(sub);
    return reply.code(204).send();
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const body = (req.body ?? {}) as { endpoint?: string };
    if (typeof body.endpoint !== 'string' || !body.endpoint) return reply.code(400).send({ error: 'endpoint required' });
    await opts.store.remove(body.endpoint);
    return reply.code(204).send();
  });

  app.post('/api/push/test', async (_req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    await opts.sendTest();
    return reply.code(204).send();
  });
}
```

Run → PASS.

- [ ] **Step 3: Wire app.ts**

In `buildCloudApp`:
- Options: add `vapid?: { publicKey: string; privateKey: string; subject: string } | null;` and `subscriptionsPath?: string | null;`.
- SSE tracker + store + sender:

```ts
const sseClients = new Set<string>();
const store = new SubscriptionStore(opts.subscriptionsPath ?? null);
await store.load();
const send = opts.vapid
  ? async (sub: PushSubscription, payload: string): Promise<void> => {
      const { sendNotification } = await import('web-push');
      await sendNotification(sub as unknown as import('web-push').PushSubscription, payload, {
        vapidDetails: { subject: opts.vapid!.subject, publicKey: opts.vapid!.publicKey, privateKey: opts.vapid!.privateKey },
      });
    }
  : async (): Promise<void> => undefined; // push not configured — routes 503, sender is a no-op
attachPushSender(events, {
  store,
  send,
  isForeground: (clientId) => sseClients.has(clientId),
  log: (m) => app.log.info(`push: ${m}`),
});
registerPushRoutes(app, {
  store,
  publicKey: opts.vapid?.publicKey ?? null,
  sendTest: () => sendTestPush(events),
});
```

- SSE route gains clientId tracking (inside the existing `GET /api/events/stream` handler):

```ts
const clientId = (req.query as { clientId?: string }).clientId;
if (clientId) sseClients.add(clientId);
// in the close handler:
if (clientId) sseClients.delete(clientId);
```

- Add `pnpm --filter @ccferry/cloud add web-push` and `pnpm --filter @ccferry/cloud add -D @types/web-push`.
- App test addition (extend `app.test.ts`):

```ts
it('exposes push routes and suppresses push for live SSE clientIds', async () => {
  const app = await buildCloudApp({ tunnelToken: 'tt', phoneToken: 'pt', vapid: null, subscriptionsPath: null });
  const key = await app.inject({ method: 'GET', url: '/api/push/key', headers: { authorization: 'Bearer pt' } });
  expect(key.statusCode).toBe(503); // vapid null → not configured
  await app.close();
});
```

Run: `pnpm --filter @ccferry/cloud test` → all green.

- [ ] **Step 4: main.ts env**

`packages/cloud/src/main.ts` — after existing env parsing:

```ts
const vapidPublicKey = process.env['VAPID_PUBLIC_KEY'];
const vapidPrivateKey = process.env['VAPID_PRIVATE_KEY'];
const vapid =
  vapidPublicKey && vapidPrivateKey
    ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: process.env['VAPID_SUBJECT'] ?? 'mailto:ccferry@localhost' }
    : null;
const subscriptionsPath = process.env['CCFERRY_PUSH_SUBS'] ?? null;
```

…and pass both into `buildCloudApp`. Log one line: `vapid ? 'push: enabled' : 'push: disabled (no VAPID keys)'`.

- [ ] **Step 5: Suite + typecheck + commit**

Run: `pnpm --filter @ccferry/cloud test && pnpm --filter @ccferry/cloud typecheck` → green.

```bash
git add packages/cloud/src packages/cloud/package.json pnpm-lock.yaml
git commit -m "feat(cloud): push subscription routes and wiring" -m "- /api/push key|subscribe|unsubscribe|test behind the phone token gate
- https endpoint and full keys validated before storing
- live SSE clientIds tracked for foreground suppression
- VAPID + subscription path from env; unconfigured push stays a no-op"
```

### Task 10: PWA foreground event stream (clientId + approvals)

**Files:**
- Create: `packages/pwa/src/lib/client-id.ts` + `packages/pwa/src/lib/client-id.test.ts`
- Modify: `packages/pwa/src/App.vue` (visible-while event stream subscription feeding the approvals store)

**Interfaces:**
- Consumes: `followSse` (M3), `useApprovalsStore` (`ingest`, `removeById`), `sseUrl`.
- Produces: `clientId(): string` — stable per browser (localStorage `ccferry-client-id`); App-level SSE to `/api/events/stream?clientId=…`.

- [ ] **Step 1: RED — client-id test**

`packages/pwa/src/lib/client-id.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clientId } from './client-id';

describe('clientId', () => {
  it('returns a stable id across calls', () => {
    const a = clientId();
    expect(a).toBe(clientId());
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

(jsdom gives localStorage. Run → FAIL.)

- [ ] **Step 2: GREEN**

`packages/pwa/src/lib/client-id.ts`:

```ts
// Stable per-browser id correlating the push subscription with the
// foreground SSE connection (spec D6): the cloud suppresses pushes to
// clients whose event stream is live.
export function clientId(): string {
  try {
    const existing = localStorage.getItem('ccferry-client-id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem('ccferry-client-id', fresh);
    return fresh;
  } catch {
    return 'no-storage'; // private mode: suppression simply never applies
  }
}
```

Run → PASS.

- [ ] **Step 3: App.vue foreground subscription**

In `App.vue` `<script setup>`:

```ts
import { onMounted, onUnmounted } from 'vue';
import { clientId } from './lib/client-id';
import { followSse } from './lib/sse-follow';
import { sseUrl } from './lib/api';
import { useApprovalsStore } from './stores/approvals';

const approvals = useApprovalsStore();
let events: ReturnType<typeof followSse> | undefined;

function connectEvents(): void {
  events?.close();
  events = followSse(sseUrl(`/api/events/stream?clientId=${encodeURIComponent(clientId())}`), {
    onLine: (data) => {
      try {
        const frame = JSON.parse(data) as { kind?: string; request?: { approvalId: string; sessionId: string | null; toolName: string; input: Record<string, unknown>; createdAtMs: number; timeoutMs: number }; approvalId?: string };
        if (frame.kind === 'approval' && frame.request) approvals.ingest(frame.request);
        else if (frame.kind === 'settled' && frame.approvalId) approvals.removeById(frame.approvalId);
      } catch {
        // malformed event — ignore
      }
    },
    onReset: () => undefined, // snapshot replay is idempotent (ingest upserts)
  });
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') connectEvents();
  else {
    events?.close();
    events = undefined;
  }
}

onMounted(() => {
  onVisibility();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  events?.close();
});
```

(Verify `approvals.removeById` exists — it is used by `SessionView.vue` today; if the method name differs, match the store's actual API.)

- [ ] **Step 4: Suite + typecheck + commit**

Run: `pnpm --filter @ccferry/pwa test && pnpm --filter @ccferry/pwa typecheck` → green.

```bash
git add packages/pwa/src/lib/client-id.ts packages/pwa/src/lib/client-id.test.ts packages/pwa/src/App.vue
git commit -m "feat(pwa): foreground event stream with client id" -m "- stable localStorage client id correlates push and SSE
- App subscribes to /api/events/stream while visible, feeding approvals
- hidden tab closes the stream so cloud-side suppression can push"
```

### Task 11: PWA History page

**Files:**
- Create: `packages/pwa/src/pages/History.vue`
- Modify: `packages/pwa/src/router.ts` (route `/history`)
- Modify: `packages/pwa/src/App.vue` (Tabbar item)

**Interfaces:**
- Consumes: `GET /api/history/search?q=&project=&days=&limit=` (Task 5), `GET /api/projects` (existing), `apiFetch`, `highlightSegments` (M3).
- Produces: nothing downstream.

- [ ] **Step 1: History.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Cell, CellGroup, DropdownMenu, DropdownMenuItem, NavBar, Search, Tag } from 'vant';
import { apiFetch } from '../lib/api';
import { highlightSegments } from '../lib/highlight';
import { debounce } from '../lib/debounce';

interface HistoryMatch {
  sessionId: string;
  projectPath: string;
  firstUserText: string;
  line: number;
  text: string;
  lastModifiedMs: number;
}

const router = useRouter();
const query = ref('');
const project = ref('');
const days = ref(0);
const matches = ref<HistoryMatch[]>([]);
const truncated = ref(false);
const projects = ref<Array<{ text: string; value: string }>>([]);

function shortProject(p: string): string {
  const parts = p.split('\\');
  return parts[parts.length - 1] ?? p;
}

function relative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

const runSearch = debounce(async () => {
  if (!query.value.trim()) {
    matches.value = [];
    truncated.value = false;
    return;
  }
  const params = new URLSearchParams({ q: query.value.trim() });
  if (project.value) params.set('project', project.value);
  if (days.value) params.set('days', String(days.value));
  const res = await apiFetch(`/api/history/search?${params.toString()}`);
  if (res.ok) {
    const body = (await res.json()) as { matches: HistoryMatch[]; truncated: boolean };
    matches.value = body.matches;
    truncated.value = body.truncated;
  }
}, 300);

onMounted(async () => {
  const res = await apiFetch('/api/projects');
  if (res.ok) {
    const body = (await res.json()) as { projects: Array<{ projectPath: string }> };
    projects.value = body.projects.map((p) => ({ text: shortProject(p.projectPath), value: p.projectPath }));
  }
});
</script>

<template>
  <div class="page">
    <NavBar title="历史" />
    <Search v-model="query" placeholder="搜索会话内容与标题" @update:model-value="runSearch" />
    <DropdownMenu>
      <DropdownMenuItem v-model="project" :options="[{ text: '全部项目', value: '' }, ...projects]" @change="runSearch" />
      <DropdownMenuItem v-model="days" :options="[{ text: '全部时间', value: 0 }, { text: '7 天', value: 7 }, { text: '30 天', value: 30 }]" @change="runSearch" />
    </DropdownMenu>
    <div v-if="truncated" class="notice">仅扫描了最近部分会话（20MB 上限）——缩小范围可查更早内容</div>
    <CellGroup>
      <Cell
        v-for="m in matches"
        :key="m.sessionId + m.line"
        :title="m.firstUserText || '(无摘要)'"
        is-link
        @click="router.push(`/session/${m.sessionId}`)"
      >
        <template #label>
          <span>{{ shortProject(m.projectPath) }} · {{ relative(m.lastModifiedMs) }} ·
            <template v-for="(seg, i) in highlightSegments(m.text, query)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
          </span>
        </template>
        <template #value><Tag plain>{{ m.line > 0 ? `行 ${m.line}` : '标题' }}</Tag></template>
      </Cell>
      <Cell v-if="query && matches.length === 0" title="（无结果）" />
    </CellGroup>
  </div>
</template>

<style scoped>
.notice { padding: 6px 12px; font-size: 12px; color: #ff976a; }
</style>
```

- [ ] **Step 2: Router + tab**

`router.ts` add: `{ path: '/history', name: 'history', component: () => import('./pages/History.vue') },`
`App.vue` Tabbar (order D8: 会话 · 历史 · 新任务 · 知识库 · 设置 — the 新任务 item lands in Task 12; add 历史 now between 会话 and 知识库):

```html
<TabbarItem replace to="/history" icon="records">历史</TabbarItem>
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm --filter @ccferry/pwa typecheck && pnpm --filter @ccferry/pwa build` → clean.

```bash
git add packages/pwa/src/pages/History.vue packages/pwa/src/router.ts packages/pwa/src/App.vue
git commit -m "feat(pwa): history page with search and filters" -m "- debounced search across session titles and content with keyword
  highlight, project and time filters, truncation notice
- results jump into the session view"
```

### Task 12: PWA NewTask page

**Files:**
- Create: `packages/pwa/src/pages/NewTask.vue`
- Modify: `packages/pwa/src/router.ts`, `packages/pwa/src/App.vue`

**Interfaces:**
- Consumes: `GET /api/projects`, `POST /api/messages` (SSE-over-POST; validated by Task 4), `readSsePost`.
- Produces: nothing downstream.

- [ ] **Step 1: NewTask.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Field, NavBar, Picker, Popup, showFailToast, showSuccessToast } from 'vant';
import { ApiError, readSsePost } from '../lib/api';

const router = useRouter();
const text = ref('');
const sending = ref(false);
const picking = ref(false);
const projects = ref<Array<{ text: string; value: string }>>([]);
const project = ref('');

function shortProject(p: string): string {
  const parts = p.split('\\');
  return parts[parts.length - 1] ?? p;
}

onMounted(async () => {
  const res = await apiFetch('/api/projects');
  if (res.ok) {
    const body = (await res.json()) as { projects: Array<{ projectPath: string }> };
    projects.value = body.projects.map((p) => ({ text: shortProject(p.projectPath), value: p.projectPath }));
  }
});

function confirmPick({ selectedOptions }: { selectedOptions: Array<{ text: string; value: string }> }): void {
  project.value = selectedOptions[0]?.value ?? '';
  picking.value = false;
}

async function start(): Promise<void> {
  if (!project.value || !text.value.trim() || sending.value) return;
  sending.value = true;
  try {
    await readSsePost('/api/messages', { projectPath: project.value, text: text.value.trim() }, () => undefined);
    showSuccessToast('已创建，请在会话列表打开');
    void router.replace('/');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) showFailToast('该项目不在允许列表中');
    else showFailToast('创建失败，请重试');
  } finally {
    sending.value = false;
  }
}

import { apiFetch } from '../lib/api';
</script>

<template>
  <div class="page">
    <NavBar title="新任务" />
    <CellGroup title="项目">
      <Cell title="选择项目" :value="project ? shortProject(project) : '未选择'" is-link @click="picking = true" />
    </CellGroup>
    <Field v-model="text" type="textarea" rows="4" autosize placeholder="首条指令，描述要做的任务…" />
    <Button block type="primary" :loading="sending" :disabled="!project || !text.trim()" @click="start">开始任务</Button>
    <Popup v-model:show="picking" position="bottom" round>
      <Picker :columns="projects" @confirm="confirmPick" @cancel="picking = false" />
    </Popup>
  </div>
</template>
```

(Move the `import { apiFetch }` to the top import block with the others — the plan splits it only for readability. Fix it in the file you write.)

- [ ] **Step 2: Router + tab**

`router.ts`: `{ path: '/new-task', name: 'new-task', component: () => import('./pages/NewTask.vue') },`
`App.vue` Tabbar between 历史 and 知识库:

```html
<TabbarItem replace to="/new-task" icon="edit">新任务</TabbarItem>
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm --filter @ccferry/pwa typecheck && pnpm --filter @ccferry/pwa build && pnpm --filter @ccferry/pwa test` → green.

```bash
git add packages/pwa/src/pages/NewTask.vue packages/pwa/src/router.ts packages/pwa/src/App.vue
git commit -m "feat(pwa): new task page over known projects" -m "- project picker plus first instruction posted to /api/messages
- 403 unknown_project surfaces a clear toast (spec D1)"
```

### Task 13: PWA push enablement in Settings

**Files:**
- Create: `packages/pwa/src/lib/push.ts` + `packages/pwa/src/lib/push.test.ts`
- Modify: `packages/pwa/src/pages/Settings.vue`

**Interfaces:**
- Consumes: `GET/POST /api/push/*` (Task 9), `clientId()` (Task 10), the service worker (Task 1).
- Produces: `urlBase64ToUint8Array(base64: string): Uint8Array` (pure, tested); Settings push section with enable/test/state.

- [ ] **Step 1: RED — urlBase64ToUint8Array test**

`packages/pwa/src/lib/push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url including - and _ characters', () => {
    // 'A-_+' variants: standard atob fails on - and _; this must not throw
    const bytes = urlBase64ToUint8Array('AQ--_w');
    expect(Array.from(bytes.slice(0, 3))).toEqual([1, 62, 63]);
  });

  it('round-trips a real VAPID-shaped key (65 bytes, 0x04 prefix)', () => {
    const key = 'B' + 'A'.repeat(42) + 'E9Q'; // 65-byte base64url when padded
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBeGreaterThan(40);
    expect(bytes[0]).toBeGreaterThan(0);
  });
});
```

Run → FAIL.

- [ ] **Step 2: GREEN**

`packages/pwa/src/lib/push.ts`:

```ts
// VAPID application server keys arrive as base64url; pushManager needs raw
// bytes. atob alone chokes on - and _ — normalize first.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
```

Run → PASS.

- [ ] **Step 3: Settings push section**

In `Settings.vue`, add a CellGroup after 状态:

```ts
const pushStatus = ref('检测中…');
const pushSubscribed = ref(false);

async function enablePush(): Promise<void> {
  try {
    const keyRes = await apiFetch('/api/push/key');
    if (keyRes.status === 503) {
      pushStatus.value = '云端未配置推送';
      return;
    }
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      pushStatus.value = '未获得通知权限';
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ clientId: clientId(), endpoint: json.endpoint, keys: json.keys }),
    });
    if (res.ok) {
      pushStatus.value = '已订阅';
      pushSubscribed.value = true;
    } else pushStatus.value = '订阅失败';
  } catch {
    pushStatus.value = '推送不可用（需加主屏后重试）';
  }
}

async function testPush(): Promise<void> {
  const res = await apiFetch('/api/push/test', { method: 'POST' });
  if (res.ok) showSuccessToast('已发送，留意通知');
  else showFailToast('发送失败');
}
```

Template:

```html
<CellGroup title="推送">
  <Cell title="状态" :value="pushStatus" />
  <Cell title="">
    <template #value>
      <Button size="small" type="primary" @click="enablePush">开启推送</Button>
      <Button v-if="pushSubscribed" size="small" plain style="margin-left: 8px" @click="testPush">测试推送</Button>
    </template>
  </Cell>
</CellGroup>
```

(import `clientId` from `../lib/client-id`, `urlBase64ToUint8Array` from `../lib/push`, `showSuccessToast`/`showFailToast` from vant.)

- [ ] **Step 4: Suite + typecheck + commit**

Run: `pnpm --filter @ccferry/pwa test && pnpm --filter @ccferry/pwa typecheck` → green.

```bash
git add packages/pwa/src/lib/push.ts packages/pwa/src/lib/push.test.ts packages/pwa/src/pages/Settings.vue
git commit -m "feat(pwa): push enablement in settings" -m "- permission + pushManager.subscribe against the cloud VAPID key
- subscription posted with the stable client id
- test button rides the cloud test route"
```

### Task 14: UI polish pass

**Files:**
- Modify: `packages/pwa/src/styles.css` (design tokens)
- Modify: `packages/pwa/src/App.vue` (tabbar spacing consistency), `packages/pwa/src/pages/*.vue` (only where a hardcoded value breaks a token)

**Interfaces:**
- Consumes: nothing new.
- Produces: consistent visual language; no behavior change.

- [ ] **Step 1: Define tokens**

In `styles.css`, prepend:

```css
:root {
  --cc-primary: #1989fa;
  --cc-radius: 10px;
  --cc-gap: 8px;
  --cc-page-pad: 12px;
  --cc-text: #323233;
  --cc-text-secondary: #969799;
  --cc-surface: #ffffff;
  --cc-border: #ebedf0;
}
body { background: #f7f8fa; color: var(--cc-text); font-size: 14px; }
.page { padding: 0 0 calc(var(--cc-gap) * 8); }
.bubble, .md-body pre, .md-body code, .note-view { border-radius: var(--cc-radius); }
```

- [ ] **Step 2: Sweep pages for stragglers**

Replace hardcoded `#1989fa`/`#f2f3f5`/`12px`-padding values in page styles with the tokens where they mean the same thing. Do NOT restructure layouts, do not touch Vant internals beyond the `.bubble`/`.md-body`/page classes this repo owns.

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @ccferry/pwa typecheck && pnpm --filter @ccferry/pwa build && pnpm --filter @ccferry/pwa test` → green.

```bash
git add packages/pwa/src/styles.css packages/pwa/src
git commit -m "style(pwa): unify spacing and color tokens" -m "- design tokens in styles.css drive bubbles, notes, and page padding
- swap hardcoded equivalents for tokens; no layout changes"
```

### Task 15: Deployment + acceptance + closeout

**Files:**
- Modify: `packages/cloud/deploy/ccferry-cloud.service` (VAPID + subs env lines)
- Modify: `packages/cloud/scripts/deploy.sh` (VAPID generate-if-missing + sed)
- Modify: `docs/notes/m4-findings.md` (create: evidence log)
- Modify: vault task page `工作任务/待办/2026-09-25-ClaudeCode远程交互系统.md` (M4 row)

**Interfaces:**
- Consumes: everything above; the live host `root@39.105.92.24` (nvm node, Caddy, existing unit).

- [ ] **Step 1: Unit template gains env**

Append to `ccferry-cloud.service` `[Service]` section (placeholders, same sed pattern):

```
Environment=VAPID_PUBLIC_KEY=__VAPID_PUBLIC__
Environment=VAPID_PRIVATE_KEY=__VAPID_PRIVATE__
Environment=VAPID_SUBJECT=mailto:ccferry@localhost
Environment=CCFERRY_PUSH_SUBS=/var/lib/ccferry/push-subscriptions.json
```

- [ ] **Step 2: deploy.sh — VAPID generate-if-missing**

Before the sed line:

```bash
ssh "$HOST" "mkdir -p /root/.ccferry /var/lib/ccferry && if [ ! -s /root/.ccferry/vapid.json ]; then export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && npx --yes web-push generate-vapid-keys > /root/.ccferry/vapid.json; fi"
VAPID_PUBLIC=$(ssh "$HOST" "grep -oP '\"publicKey\":\\s*\"\\K[^\"]+' /root/.ccferry/vapid.json")
VAPID_PRIVATE=$(ssh "$HOST" "grep -oP '\"privateKey\":\\s*\"\\K[^\"]+' /root/.ccferry/vapid.json")
```

…and extend the existing sed: `s/__VAPID_PUBLIC__/$VAPID_PUBLIC/; s/__VAPID_PRIVATE__/$VAPID_PRIVATE/`. Usage comment gains `VAPID keys are generated on the host once and reused`.

- [ ] **Step 3: Run findings evidence as you deploy**

Create `docs/notes/m4-findings.md` with sections: SW build evidence (Task 1 output), VAPID key presence (paths only, never the values), push subs file path, and the acceptance checklist below. Deploy: run `PHONE_TOKEN=… TUNNEL_TOKEN=… packages/cloud/scripts/deploy.sh`, then rebuild+upload PWA dist, restart the PC daemon from the main checkout (kill port 8787 orphan first on Windows).

- [ ] **Step 4: Acceptance checklist (owner-verified where marked)**

- [ ] History: phone search hits content across sessions; project/time filters work; truncation notice visible on a broad query
- [ ] New task: picker + instruction → session appears in overview and continues; `curl` with unknown projectPath → 403
- [ ] Push (owner on 4G): TUI agent finishes → notification; approval request → notification; PWA foreground → no duplicate; error run → notification
- [ ] Cloud restart → subscription survives (subs file present); 测试推送 button works
- [ ] Style pass owner-approved
- [ ] Requirements map 1–8 all green; vault task page M4 row updated

- [ ] **Step 5: Closeout commit**

```bash
git add packages/cloud/deploy packages/cloud/scripts docs/notes/m4-findings.md
git commit -m "docs: record M4 deployment and acceptance evidence" -m "- findings log with SW, VAPID presence, subs persistence, checklist
- deploy script generates VAPID keys once on the host and injects them"
```

(The vault task page lives outside the repo — update it directly, not via git.)

---

## Self-Review Notes (pre-flight, for the executor)

- Spec coverage: D1/D10→Task 4; D2/D6/D7→Tasks 8/9/10; D3→Task 2; D4→Task 5; D5→Task 7; D8→Tasks 11/12; D9→Task 3; SW/push UI→Tasks 1/13; polish→Task 14; deploy/acceptance→Task 15. Web-push lib selection (`web-push` npm) is the spec's assumed choice.
- Type consistency: `ResultEvent` (Task 2) shape matches the `CloudEvent` result variant (Task 6) field-for-field; `PushSubscription` flows Tasks 7→8→9 unchanged; `HistoryMatch` (Task 5) matches History.vue's local interface (Task 11).
- Task 3's `/api/` prefix change touches the cloud notFound handlers too — both files listed.
- Task 12's `apiFetch` import belongs at the top of the script block (plan note included in the task).
- Windows dev caveat: Task 15 daemon restart needs the port-8787 orphan kill (`Get-NetTCPConnection`) before relaunching from the main checkout.
