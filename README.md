# ccferry

[English](README.md) | [中文](README.zh-CN.md)

A remote companion for the Claude Code running on your PC: **monitor live coding sessions from anywhere, continue conversations, route tool approvals to your phone, receive push notifications**, and **manage your personal knowledge base** (browse / search / edit / command an agent to tidy it).

## How it works

Every Claude Code session is a local JSONL file (`~/.claude/projects/<project>/<session-id>.jsonl`); the local TUI is just one view over it. ccferry grows a second view over the same data:

- **Read plane (zero interference)**: a watcher tails the session files live — you can watch a task that is currently running locally
- **Write plane**: the Agent SDK `resume`s idle sessions with full history; `canUseTool` permission requests are routed to your phone for approval
- **Knowledge base (day-one core)**: your Obsidian vault is just another "project" — browse / search / edit hit the file system directly; "agent tidy" sends instructions to a vault session

## Architecture

```
Phone / browser ──HTTPS──▶ Cloud server (static PWA + tunnel-protocol server)
                             ⟵ WSS single outbound connection (6-frame private protocol) ⟵
                       PC agent (Agent SDK + session watcher + vault service + localhost API)
```

Single-package principle: one process on the PC, one on the cloud, all-TypeScript monorepo.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M1 | PC daemon + localhost API | ✅ 2026-09-26 |
| M2 | PWA + remote approvals + vault management (LAN) | ✅ 2026-09-26 |
| M3 | Private tunnel protocol + cloud deploy + Web Push | ✅ 2026-09-26 |
| M4 | History page + remote new tasks + polish | ✅ 2026-09-28 |
| M5 | Flutter native app (FCM push, approvals, self-update) | ✅ 2026-09-30 |

Mobile clients: the **Flutter app** (`apps/mobile`, Android APK self-updated via GitHub Releases) is the primary entry; the **PWA** stays as the web entry until the second batch of capabilities lands.

- Specs & plans: `docs/superpowers/specs/` · `docs/superpowers/plans/`
- Evidence logs: `docs/notes/m1-findings.md` … `m4-findings.md`

## Running (dev form)

```bash
pnpm install
pnpm --filter @ccferry/pwa build          # produces packages/pwa/dist served by the daemon
CCFERRY_TOKEN=<token> CCFERRY_HOST=0.0.0.0 pnpm --filter @ccferry/client start
```

- Open `http://<pc-lan-ip>:8787/` on a phone on the same Wi-Fi; enter the token once in settings
- **Without `CCFERRY_TOKEN` the daemon binds 127.0.0.1 only** (safe default); `CCFERRY_PORT` / `CCFERRY_PWA_DIR` override the port and PWA directory
- Daemon config `~/.ccferry/config.json`: `vaultPath` (knowledge-base root; unconfigured → `/api/vault/*` returns 503), `toolWhitelist` (read-only tools allowed unattended, default `Read/Glob/Grep/LS/TodoWrite`), `approvalTimeoutMs` (approval timeout denies, default 60s)
- Tests: `pnpm -r test`; typecheck: `pnpm -r typecheck`
- **Production deployment (single-package binaries + per-OS autostart) → [`docs/deploy-daemon.md`](docs/deploy-daemon.md)** — the pnpm command above is the dev form
