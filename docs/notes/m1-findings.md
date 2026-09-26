# M1 Findings

Evidence log for the M1 plan. One section per spike; fill during Tasks 2-4.

## Spike A: GLM endpoint inheritance

- Result: PASS
- Evidence: `init model: glm-5.3[1m]` / `result: OK-GLM` — a plain SDK `query()` (no explicit env or endpoint config) inherited the GLM endpoint from the machine's environment and returned a non-error reply.

## Spike B: SDK cross-store resume

- Result: PASS
- Evidence: `first reply: ACK | session: b564d9f2-7e6e-477e-b4ec-2f501948044f` / `resumed reply: 42` / `SPIKE-B: PASS` — a second `query()` in a separate process, resuming the first session id, recalled the fact stored by the first.

## Spike C: resume fork semantics

- Result: resume appends in place — same session id, same JSONL file grew; no fork, no lineage tracking needed.
- Evidence: `sid1: c40d7182-b2b9-47d2-aa5b-01bd38f07b8d` / `sid2: c40d7182-b2b9-47d2-aa5b-01bd38f07b8d` / `same id: true` / `GREW C:\Users\fetao\.claude\projects\C--Users-fetao-AppData-Local-Temp-ccferry-fork-7ovJSH\c40d7182-b2b9-47d2-aa5b-01bd38f07b8d.jsonl (+497363 bytes)` — exactly one file changed (the original session's), zero new files.

## E2E smoke (Task 9)

- Daemon: `pnpm --filter @ccferry/client start` → `ccferry daemon listening on http://127.0.0.1:8787`.
- Listing: **47 projects / 142 sessions** from the real `~/.claude/projects` store (vault, huak-tsdb, 91AI, ccferry, spikes' scratch dirs all present; `cwd`-based project resolution working).
- Live streaming: streamed the newest session (the very session running this plan, actively written by the local TUI) — SSE `data:` lines with parsed JSONL arrived in real time; zero interference with the writing process.
- Resume on an idle session (Spike C scratch session `c40d7182-…`, no `force` needed): POST `/messages` → SSE `assistant` `CC-SMOKE-OK` + `result success`, same session id; session file grew 497363 → 731718 bytes (append in place, consistent with Spike C).

**M1 closed.**

## Deferred to M3 planning

- **Single-package distribution (owner request, 2026-09-26):** follow o2a2o's scheme — `bun build --compile` → self-contained single binary (no OS Node.js), tag-driven multi-platform release workflow, native packages. Constraint: `@anthropic-ai/claude-agent-sdk` spawns the CLI child process via `process.execPath`; under a Bun-compiled exe this must be verified by a packaging spike before committing to it. Fallbacks: Node SEA, or exe + bundled Node runtime directory. Discipline meanwhile: prefer pure-JS dependencies, avoid native addons (current deps all qualify).

