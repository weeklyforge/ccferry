# M3 Findings

Evidence log for the M3 plan.

## Spike S2: Bun single binary

- bun version: `1.4.2` (installed 2026-09-26 via bun.sh installer)
- client exe builds: `bun build --compile src/main.ts` → `dist-single/ccferry-client.exe` (338 modules bundled, ~0.3s compile)
- daemon boots and serves under the Bun runtime: `CCFERRY_PORT=8790 ./dist-single/ccferry-client.exe` → `/api/projects` returned the real 47-project listing; fastify logger worked.
- **SDK subprocess under packaged exe: FAIL** — `POST /api/messages` returned:
  `{"type":"error","message":"Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable."}`
  Root cause: `@anthropic-ai/claude-agent-sdk` resolves its native CLI binary from the module tree at runtime; `bun build --compile` bundles JS only and does not embed the optional-dependency native binary, so the packaged exe has nothing to resolve.
- **Verdict: client cannot ship as a Bun single exe (D5' fallback engaged — node + tsx deploy path).**
  Nuance for Task 10: the failure is SDK-specific; the cloud package (fastify/websocket/static only, no SDK) may still be a viable single exe — verify when `packages/cloud` exists and prefer the exe for cloud, node+tsx for client.

## Spike S1: nip.io + LE + ICP interception

- DNS: `39.105.92.24.nip.io` resolves correctly via public resolvers (the dev PC's Clash fake-IP TUN hijacks it locally — all PC-side tests used `--resolve` direct-to-IP; phones unaffected).
- Certificate: LE issued after retry (first attempt hit a transient secondary-validation timeout; `/var/lib/caddy/certificates/.../39.105.92.24.nip.io.crt` present). Real external TLS traffic (scanners) reached the site — 443 globally reachable.
- **ICP interception: NONE observed** on 443. Verdict: **PASS, stay on 443** (8443 fallback not needed).
- Owner correction recorded: my initial "security group blocks 443" diagnosis was wrong (fooled by local TUN + one transient LE retry).

## Deployment

- Server prep: Caddy v2.11.4 (apt, cloudsmith repo); node via **nvm** (owner directive) — gitee nvm mirror + npmmirror node binaries + npmmirror registry (GitHub unreachable from the server).
- Server-side workspace: trimmed to cloud+protocol; the scp'd lockfile tripped pnpm 12's default `minimumReleaseAge` supply-chain policy (it scanned the client's SDK entries) — resolved by deleting the lockfile and re-resolving fresh (93 packages).
- `ccferry-cloud.service` (systemd, MemoryMax=512M, Restart=always) listening on 127.0.0.1:8788 behind Caddy. Tokens injected via sed into the unit (chmod 600).
- Deploy script fixes during the run: `scp -r` for the protocol directory.
- **End-to-end verified from the PC**: PWA shell `200`, `/api` without token `401`, and `/api/projects?token=<phone>` returned the real 47-project listing through 公网HTTPS → Caddy → WSS tunnel → PC daemon.

## Spike S3: WSS keepalive

- After 5+ minutes fully idle, `/api/approvals?token=…` through the tunnel returned `200` — the 30s PING / 60s watchdog held the connection with no reconnect. Verdict: **PASS, default intervals stand**.

## Acceptance (Task 12, owner-confirmed 2026-09-26)

- [x] 4G phone opens `https://39.105.92.24.nip.io/`, phone token saved
- [x] overview shows real projects/sessions through the tunnel
- [x] session view streams (now capped to a 256KB recent window, full history on button)
- [x] 续聊 works (after the request-body fix below); `/compact` passthrough verified for heavy sessions ("Not enough messages to compact." on a fresh session proves the command executes)
- [x] approval card pops and allow/deny works over the tunnel
- [x] vault browse/edit/search through the tunnel
- [x] disconnect recovery: daemon killed → immediate 502 `tunnel_down` (no hang) → restart → tunnel re-authenticated, API restored (exercised twice; note: stopping the shell leaves a node orphan on Windows — kill by port)
- [x] wrong phone token → 401
- [x] add to home screen

## Fix-forwards during acceptance

1. **Request bodies never crossed the tunnel** (`FST_ERR_CTP_EMPTY_JSON_BODY` on phone sends) — bridgeHttp passed no body and the protocol had no end-of-request marker; OPEN meta gained `bodyBytes`, the PC buffers body frames then fetches. Pinned by POST-echo test.
2. **`tunnel_timeout` on slow resumes** — fixed 30s request timeout killed resumed sessions whose first byte exceeds it; timeout now resets on every DATA frame (idle semantics).
3. **Session view loaded the whole file** (owner: "为什么这么多?") — tailer gained `fromByte` with partial-line skipping, stream route accepts `tailBytes`, PWA defaults to a 256KB recent window with a load-full-history button.

## Post-acceptance bounded change: markdown rendering + search highlight (2026-09-26)

Owner reported session/vault content showing as raw markdown. Bounded change on the M3 branch (PWA-only, after the frozen review range):

- `lib/markdown.ts` — marked (gfm + breaks) → DOMPurify sanitize; Obsidian wikilink extension renders `[[note]]` / `[[note|alias]]` as a highlighted non-navigable span (jump support deferred to M4). Memoized (500 entries): session streaming re-renders the bubble list per incoming line.
- SessionView: assistant bubbles render markdown via `v-html` on sanitized output; user/tool/raw bubbles stay plain text.
- NoteEditor: read/edit dual mode — notes open in a rendered reading view, explicit button switches to the textarea, save returns to the reading view.
- Vault search results highlight the keyword: `lib/highlight.ts` segments mirror the daemon's case-insensitive substring search; template segments (no v-html) keep arbitrary note text safe.
- XSS: session transcripts and vault notes can quote arbitrary HTML — sanitize is mandatory before v-html; pinned by tests (script tag and onerror stripping).
- Tests: markdown 8 (jsdom env per-file) + highlight 4; suite 141/141; rebuilt dist scp'd to the cloud (served as `index-Ctj587Tg.js`).



