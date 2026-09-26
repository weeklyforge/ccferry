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
