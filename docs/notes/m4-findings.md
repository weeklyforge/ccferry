# M4 Findings

Evidence log for the M4 plan (history + web push + remote new task + polish).

## Build evidence

- Custom service worker: `pnpm --filter @ccferry/pwa build` in injectManifest mode → `dist/sw.js` contains the push listener (`addEventListener` ×2, `showNotification` ×1). injectManifest contract: `srcDir` is the DIRECTORY, `filename` the SOURCE file name (`src` + `sw.ts`); `sw.ts` needs `/// <reference lib="webworker" />`.
- Push sender/store/routes: 48/48 cloud tests green pre-deploy; full suite 199/199 green across 4 packages after the final-review fix pass (protocol 8 + cloud 48 + pwa 36 + client 107), typecheck 0 errors.
- web-push npm installed on the host at `/opt/ccferry/cloud/node_modules/web-push`.

## Deployment (host 39.105.92.24)

- VAPID keys generated ONCE on the host at `/root/.ccferry/vapid.json` (values never leave the host; the unit references them via systemd env). Keys regenerate ONLY if that file is deleted — deleting it invalidates existing subscriptions.
- Push subscriptions persist at `/var/lib/ccferry/push-subscriptions.json`.
- `journalctl` shows `push: enabled` after restart.

## Deploy-script defects found and fixed during this deploy

1. The scp of `ccferry-cloud.service` rewrites the unit with `__TOKEN__` placeholders BEFORE sed fills them; if the server-side `pnpm install` step fails in between, the script aborted (set -e is bypassed by the `| tail` pipelines) and the live unit keeps placeholders — tunnel and phone auth both went down until tokens were re-filled. Two hardenings: server install now passes `--config.minimumReleaseAge=0` (pnpm 12 rejected freshly-published transitive deps of the fresh lockfile), and the incident produced the ops note: ALWAYS re-run the sed line (or redeploy) if any step after the scp fails.
2. `npx web-push generate-vapid-keys` banner output polluted the keys file; generation now uses `node -e` against the installed lib writing strict JSON.
3. sed on the unit must NOT anchor with `^` (lines start with `Environment=`).

## Verified from here (2026-09-26)

- Public HTTPS: PWA shell 200, `/sw.js` 200, `/api/push/key?token=<phone>` returns the VAPID public key, no-token → 401.
- Tunnel: history search returns real session-store matches through 公网HTTPS → Caddy → WSS → daemon (`q=claude&days=30`).
- Boundary: `POST /api/messages` with an unknown projectPath → `403 {"error":"unknown_project"}` both locally and through the tunnel; known/vault paths accepted (test-suite pinned).
- Daemon restarted from the M4 worktree with tunnel authenticated (PushSource polling live).

## Final review fix pass (Opus reviewer, 2026-09-27)

Verdict "Yes — with fixes": 0 Critical / 3 Important / 8 Minor; all three executor rulings verified correct (the Task 2 split-line redesign in particular fixed a real plan flaw). Fixes landed under the standing fix-without-waiting authorization:

- **I1 — history `truncated` never signaled per-file tail-capped scans**: a miss in the skipped head of a >4MB session was presented as "（无结果）" with no banner, violating D4's honesty contract. One-line fix (`if (from > 0) truncated = true`), pinned by a >4MB head-hit test.
- **I2 — deploy.sh still masked remote install failures**: the `pnpm install | tail` pipeline runs under the remote shell, whose lack of pipefail makes the pipeline's status tail's (0) — the same incident class as this cycle's outage. Fixed with `set -o pipefail;` at the head of the remote command; semantics demonstrated (`{exit 1}|tail` → 0 without, 1 with).
- **I3 — NewTask awaited the entire first agent turn**: screen lock / network blip mid-task showed "创建失败" while the task ran on. `lib/new-task-start.ts` now resolves on the FIRST streamed event (session started) and ignores post-start drops; success copy updated to "任务已在电脑上开始".
- 8 Minors deferred to the ledger (suppression gap on SSE retry window, endpoint-keyed store cleanup + no unsubscribe button, unshared cachedScan double-scan, tunnel-down result events dropped, rotation corner, bare `/api` shell fallback, history/settings UX nits, weak half-buffer test).

## Owner acceptance checklist (phone side)

- [ ] History: search hits content across sessions; project/time filters; truncation notice on a broad query
- [ ] New task: picker + instruction → session appears in overview, continues
- [ ] Push (4G 待机): TUI agent finishes → notification; approval request → notification; PWA foreground → no duplicate; error run → notification
- [ ] Cloud restart → subscription survives; 设置页「测试推送」可达
- [ ] Style pass owner-approved

## Post-acceptance incident: history tab froze the app (2026-09-27, owner-confirmed fixed)

- Symptom: tapping the 历史 tab froze the whole PWA (tabs and buttons dead) — incognito too, with and without a token; reproduced on desktop cloud sessions as main-thread evaluate timeouts.
- Not the cause: caches/SW (incognito ruled it out — an earlier precache-SW reload loop was real but separate, already fixed by the push-only minimal SW), auth paths, the search/list code (freeze fired on mount with an empty result list).
- Root cause by elimination: only Vant DropdownMenu/DropdownItem were unique to the History page; NavBar+Search+Cell are proven on the vault page and Popup+Picker on the new-task page. jsdom cannot reproduce it (no real layout), which is why component-mount tests passed while real browsers froze.
- Fix: filters became two tags opening bottom Picker popups (98a6905); verified with a freeze oracle on the live cloud — mount + main-thread evaluate + tab roundtrip all pass where the old build timed out — then owner-confirmed on the phone.
- Lessons: an "alive" readyState check proves nothing about post-mount wedges (evaluate-return is the real oracle); Vant DropdownMenu stays off the banned-for-now list until its specific loop is understood; never ship a tab removal as a "fix" without the owner's explicit call.
