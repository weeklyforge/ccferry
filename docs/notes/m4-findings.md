# M4 Findings

Evidence log for the M4 plan (history + web push + remote new task + polish).

## Build evidence

- Custom service worker: `pnpm --filter @ccferry/pwa build` in injectManifest mode → `dist/sw.js` contains the push listener (`addEventListener` ×2, `showNotification` ×1). injectManifest contract: `srcDir` is the DIRECTORY, `filename` the SOURCE file name (`src` + `sw.ts`); `sw.ts` needs `/// <reference lib="webworker" />`.
- Push sender/store/routes: 48/48 cloud tests green pre-deploy; full suite 175+ green across 4 packages at closeout.
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

## Owner acceptance checklist (phone side)

- [ ] History: search hits content across sessions; project/time filters; truncation notice on a broad query
- [ ] New task: picker + instruction → session appears in overview, continues
- [ ] Push (4G 待机): TUI agent finishes → notification; approval request → notification; PWA foreground → no duplicate; error run → notification
- [ ] Cloud restart → subscription survives; 设置页「测试推送」可达
- [ ] Style pass owner-approved
