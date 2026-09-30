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

### Update 2026-09-30: client single package works with a sibling binary

- SDK 0.3.283 ships the CLI as a native `claude.exe` in the platform
  optional-dependency (`@anthropic-ai/claude-agent-sdk-win32-x64`, ~245MB); the
  S2 failure was only that `bun --compile` cannot embed it.
- `sdk-driver.ts` now resolves `claude(.exe)` **next to its own exe** and passes
  it as `pathToClaudeCodeExecutable` (dev form unchanged — falls back to
  module-tree resolution). `scripts/build-single.sh client` stages the binary
  beside the exe: the deployable unit is the `dist-single/` folder.
- Re-verified the S2 probe on the compiled exe (2026-09-30): `/api/projects`
  200 with the real listing, and `POST /api/messages` `/compact` on a known
  project returned `Not enough messages to compact.` — the SDK subprocess
  spawns and streams through the exe. **The S2 client FAIL above is superseded
  for the sidecar layout; single-FILE remains impossible.**

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

- ~~After 5+ minutes fully idle, `/api/approvals?token=…` through the tunnel returned `200` — the 30s PING / 60s watchdog held the connection with no reconnect. Verdict: **PASS, default intervals stand**.~~
- **Retracted by the final review**: the original client never answered PING, so the "held connection" was actually a reconnect cycle (~90s kill → ~1s down → re-auth). A single 200 cannot distinguish the two. See the final-review section for the C1 fix and the S3 re-run below.

### S3 re-run with evidence (post-C1, 2026-09-26)

- Tunnel (fixed client) authenticated 21:11:37; observed fully idle past 21:17 — **0** `tunnel closed, reconnecting` lines in the PC daemon log, **0** tunnel/websocket error entries in `journalctl -u ccferry-cloud` for the window, service `active`, daemon API `200`.
- 5.5 idle minutes span ~5 of the old defect's kill cycles, so zero reconnects distinguishes a held connection from the old cycle — the thing the original single-200 check could not do.
- Plus regression tests at accelerated intervals (client answers PING; authenticated DATA counts as liveness) pin the behavior in CI.
- Verdict: **PASS stands, default 30s/60s intervals**, now evidence-backed.

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

## Final review (Opus) and fix pass (2026-09-26)

Reviewer verdict on 29e121c..db0742b: **"No — with fixes"** — 2 Critical, 4 Important, 9 Minor, all Critical/Important empirically reproven in a throwaway worktree. Fixed the same day under the owner's standing fix-without-waiting authorization:

- **C1 — the PC never answered PING.** The cloud watchdog terminated every tunnel ~60-90s after AUTH_OK; long streams were severed mid-flight and EventSource auto-reconnect masked it as "4G flakiness". Client now PONGs; the cloud also counts any authenticated inbound frame as liveness. This also falsified the original S3 "PASS" below — a single 200 at the 5-minute mark cannot distinguish a held connection from a ~98%-availability reconnect cycle. Re-run with log evidence: see S3 re-run.
- **C2 — a tunnel drop left in-flight requests hanging until the 30s idle timeout** instead of the spec's immediate 502. `onPeerDrop` now fails all pending streams (502 before headers, raw destroy mid-stream).
- **I1 — AUTH bans keyed on Caddy's loopback address**, so a remote attacker could keep the legitimate PC banned indefinitely with 5 bad AUTHs. Bans now key on the last `x-forwarded-for` entry behind loopback; maps prune expired entries.
- **I2 — spec backpressure v0 was never implemented.** Client holds DATA while `bufferedAmount > 16MB`; cloud writes responses through an ordered writer honoring socket drain (CLOSE waits for queued DATA via `flush()` — a race the new tests caught).
- **I3 — phone disconnects never propagated.** Cloud now sends CLOSE when the phone hangs up mid-response; the PC aborts the upstream fetch (and the agent run behind it) instead of streaming to a dead phone.
- **I4 — acceptance fix-forwards lacked regression tests**: activity-reset timeout and tailBytes route arithmetic now pinned.
- 9 Minors deferred to the ledger (OPEN-frame hand-decode, forwarded `?token=`, multi-value headers, 1MB body limit, ping-timer peer aliasing, `/api` prefix match, `void Buffer`, requestBuffers on raw close, daemon stop handler).
- Suite after the pass: **162/162** (protocol 8, cloud 30, pwa 30, client 94); typecheck clean; both ends redeployed (cloud restarted active; PWA re-uploaded).

Owner-visible symptom explained: the repeated "哪天考试?" bubbles were C1 (tunnel killed every ~90s) × the PWA's EventSource auto-reconnect replaying the 256KB tail without clearing (`sse-follow.ts` now resets the view on reconnect, commit 823ac97).



