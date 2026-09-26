# M2 Findings

Evidence log for the M2 plan. Acceptance = spec section 5 (LAN 全流程).

## PC-side API smoke (token = env, LAN bind 0.0.0.0:8787)

- Daemon: `CCFERRY_TOKEN=… CCFERRY_HOST=0.0.0.0 pnpm --filter @ccferry/client start` → listening on 0.0.0.0:8787 (LAN IP 192.168.31.222), PWA shell `200 text/html`, no "PWA directory not found" warning.
- `GET /api/projects` with `Authorization: Bearer` → real 47-project listing.
- `GET /api/vault/tree` → real vault root, nested nodes.
- No token → `401`; `?token=` accepted for SSE.
- `GET /api/vault/file?path=../x.md` → `400 {"error":"path_escape"}`.
- `GET /api/vault/search?q=智慧供热` → real matches with line numbers.
- `GET /api/approvals` → `{"approvals":[]}`.

## Approval fail-closed

- Direct broker probe (2s timeout): `{"behavior":"deny","message":"approval timeout (2s) — denied by default"}`.

## Phone acceptance checklist (all PASS, 2026-09-26)

- [x] PWA loads on LAN + token entry
- [x] overview with awaiting/running/idle badges
- [x] live stream + 续聊
- [x] approval card pops, allow/deny flow (owner confirmed)
- [x] vault browse / edit / search
- [x] agent 整理 → new vault session appears, streams, writes gated by approval card (owner confirmed "跑通了，批准卡也弹了")
- [x] add to home screen

## Defects found during smoke (fix-forward commits)

1. **Stale M1 daemon orphan** held 127.0.0.1:8787 (node child survived its shell) — M2 answered on LAN but 127.0.0.1 hit the old process; killed the orphan, no code change. Ops note: stop daemons via process, not just shell.
2. **SSE headers not flushed on empty pending** — `writeHead` without a body write buffers headers for the 15s keepalive; EventSource hung in CONNECTING on the phone. Fix: opening comment write + regression test (`7e20a09`).
3. **`.trash/` searched and listed** — Obsidian's trash leaked into results (real match in smoke). Fix: added to `IGNORED_DIRS` + test (`7e20a09`).
4. **Vant 4 removed function-call APIs** — plan's code used `Dialog.confirm` / `Toast.*` (Vant 2/3 API); phone hit `confirm is not a function` on agent 整理. Fix: `showConfirmDialog`/`showDialog`/`showSuccessToast`/`showFailToast`, cancel path caught (`2ca8767`, phone-verified).

## Deferred (owner decision, 2026-09-26)

- UI styling polish — functional-but-ugly accepted for M2.
- The "已创建 vault 会话" dialog only fires after the full agent turn completes; real feedback is the new session row appearing within ~10s polling. Improve with M3 push/events.
