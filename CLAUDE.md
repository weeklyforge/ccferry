# CLAUDE.md

ccferry — a remote companion for local Claude Code: monitor and continue sessions from anywhere, route tool approvals to a phone, and manage the owner's personal markdown knowledge base.

## Repository nature

TypeScript pnpm monorepo. Each runtime product ships as ONE package/process:

- `packages/protocol` — shared wire types, no runtime dependencies.
- `packages/client` — PC-side daemon: Claude Agent SDK driver, session store watcher, knowledge-base (vault) file service, localhost API.
- Cloud server (M3) and PWA (M2) arrive in later milestones per the spec; do not scaffold them early.

## Key documents

- Spec (source of truth): `docs/superpowers/specs/2026-09-25-claude-code-remote.md`
- Current plan: `docs/superpowers/plans/2026-09-26-m1-local-daemon.md` (milestone M1)
- Evidence log: `docs/notes/m1-findings.md`

## Commands

```bash
pnpm install
pnpm -r test          # vitest everywhere
pnpm -r typecheck
pnpm --filter @ccferry/client start      # run the daemon (M1+)
pnpm --filter @ccferry/client exec tsx scripts/spikes/<script>.ts   # spike scripts
```

## Conventions

- Code and code comments in English only — no Chinese in source files. UI copy may be Chinese (PWA, M2+).
- Commits: conventional-commit subject + markdown bullet body; no `Co-Authored-By` lines. Never push unless the owner explicitly asks.
- Tests: vitest, co-located as `*.test.ts` next to the module under test.
- Runtime: tsx for dev; `moduleResolution: bundler`; strict TypeScript with `noUncheckedIndexedAccess`.

## Hard rules

- Never hardcode API tokens or keys. The GLM endpoint is inherited from the environment, exactly like the local Claude Code CLI.
- Red line: never write to a session that is currently active in the local TUI. The API layer guards this with an activity window; only an explicit `force: true` bypasses it.
- Knowledge-base service (M2) must sandbox every file operation inside the configured vault root and reject any path that escapes it.
- Never copy credentials from the owner's vault notes into this repository.

## Environment

- Windows 11 dev machine; shell steps assume Git Bash.
- The owner's Claude Code session store: `~/.claude/projects/` — one JSONL file per session, directories named after munged project paths (resolve the real `cwd` from inside the file's lines; the munged name is display-only).
