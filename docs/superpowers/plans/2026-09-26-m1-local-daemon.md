# ccferry M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost Claude Code companion daemon (M1): scans the local CC session store, live-streams any session, and resumes idle sessions via the Claude Agent SDK — verified against the real GLM backend.

**Architecture:** Claude Code sessions are JSONL files under `~/.claude/projects/<project>/<session-id>.jsonl`; the local TUI is just one view of them. ccferry adds a second view: a Fastify server with SSE endpoints (list / live-tail / resume-and-send) driven by a `SessionDriver` abstraction. A deny-all `canUseTool` stub keeps M1 safe; remote approval arrives in M2.

**Tech Stack:** Node >= 20, pnpm workspaces, TypeScript (strict), `@anthropic-ai/claude-agent-sdk`, Fastify, vitest, tsx. Windows dev machine; shell steps assume Git Bash.

**Spec:**
- In-repo copy: `docs/superpowers/specs/2026-09-25-claude-code-remote.md`
- Original tracker: `D:\Development\MyWorkspace\github\fetaoily\my-obsidian-docs\my-obsidian-docs\工作任务\待办\2026-09-25-ClaudeCode远程交互系统.md`

**Scope:** This plan covers **M1 only** (PC bare-metal daemon + three SDK verifications + localhost API). M2 (PWA + permission routing + knowledge-base management), M3 (private tunnel protocol + cloud), M4 (history pages) get their own plans after M1 evidence lands in `docs/notes/m1-findings.md`. Note: the owner elevated knowledge-base management (read/write + agent-directed organization) to first-class priority on 2026-09-26 — it lands in the M2 plan and rides this same daemon.

## Global Constraints

- All code and code comments in English; no Chinese anywhere in source files.
- Never hardcode API tokens or passwords; the GLM endpoint comes from inherited environment settings (same mechanism the local Claude Code CLI already uses).
- Red line: never write to a session that is currently active (guarded by the `ACTIVE_WINDOW_MS` check in Task 8; override only via explicit `force: true`).
- Monorepo layout: `packages/protocol` (shared wire types), `packages/client` (the M1 daemon). Each end-product ships as ONE runnable package (client = one process).
- Commits: conventional-commit subject + markdown bullet body; no `Co-Authored-By` lines; never push unless explicitly told.
- Tests: vitest, co-located as `*.test.ts` next to the module under test.
- Do not copy anything from the vault's `账号管理/` (credentials) into this repo.

## Review Focus

Failure modes the spec implies but happy-path tests miss — each is pinned by a test in its owning task:

1. **Partial / malformed JSONL line** (CC writes line-by-line; readers can catch a half-written line) → `parseLine` returns `{ ok: false }` and every consumer skips it without crashing. Pinned in Task 5 (parser test).
2. **Huge session files** (real sessions exceed 20 MB) → the scanner reads only a capped head for metadata; the tailer reads from a byte offset and never loads the whole file. Pinned in Task 5 (head-cap test) and Task 6 (offset test).
3. **Resume on an active session** → API returns 409 `session_active` unless `force: true`. Pinned in Task 8.
4. **File truncation/rotation mid-tail** → tailer resets its offset to 0 and keeps working instead of crashing or spinning. Pinned in Task 6.
5. **Unterminated last line / CRLF endings (Windows)** → a line without `\n` is not emitted until the newline arrives; a trailing `\r` is stripped. Pinned in Task 6.

---

### Task 1: Monorepo scaffold + protocol package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (already exists from repo bootstrap — extend if needed)
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/index.test.ts`
- Create: `packages/client/package.json`, `packages/client/tsconfig.json`, `packages/client/src/main.ts`
- Create: `docs/notes/m1-findings.md`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: pnpm workspace with `@ccferry/protocol` and `@ccferry/client`; the shared types below are used by every later task; `docs/notes/m1-findings.md` skeleton.

- [ ] **Step 1: Create workspace root files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`package.json` (root):

```json
{
  "name": "ccferry",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore` (append to the bootstrap one if absent):

```
node_modules/
dist/
coverage/
*.log
.env
```

- [ ] **Step 2: Create the protocol package with shared types**

`packages/protocol/package.json`:

```json
{
  "name": "@ccferry/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/protocol/src/index.ts`:

```ts
export interface ProjectSummary {
  projectPath: string;
  sessionCount: number;
}

export interface SessionSummary {
  sessionId: string;
  projectPath: string;
  file: string;
  sizeBytes: number;
  lastModifiedMs: number;
  firstUserText: string;
}

export type ParsedLine =
  | { ok: true; line: number; json: Record<string, unknown> }
  | { ok: false; line: number };

export type DriverEvent =
  | { type: 'assistant'; text: string }
  | { type: 'system'; subtype: string }
  | { type: 'result'; subtype: string; text: string; sessionId: string };

export type StreamMessage =
  | { type: 'snapshot'; sessions: SessionSummary[] }
  | { type: 'append'; sessionId: string; lines: ParsedLine[] };
```

`packages/protocol/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ParsedLine } from './index';

describe('protocol types', () => {
  it('accepts a well-formed ParsedLine', () => {
    const line: ParsedLine = { ok: true, line: 1, json: { type: 'user' } };
    expect(line.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Create the client package skeleton**

`packages/client/package.json`:

```json
{
  "name": "@ccferry/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "scripts", "test"]
}
```

`packages/client/src/main.ts` (placeholder composed in Task 8; keep runnable):

```ts
console.log('ccferry client: not wired yet (Task 8)');
```

`docs/notes/m1-findings.md`:

```markdown
# M1 Findings

Evidence log for the M1 plan. One section per spike; fill during Tasks 2-4.

## Spike A: GLM endpoint inheritance

- Result: (pending)
- Evidence: (paste init model + result)

## Spike B: SDK cross-store resume

- Result: (pending)
- Evidence: (paste session ids and reply)

## Spike C: resume fork semantics

- Result: (pending)
- Evidence: (file listing before/after)
```

- [ ] **Step 4: Install dependencies and verify the harness**

```bash
pnpm install
pnpm --filter @ccferry/protocol add -D typescript vitest
pnpm --filter @ccferry/client add @anthropic-ai/claude-agent-sdk fastify
pnpm --filter @ccferry/client add -D typescript vitest tsx @types/node
pnpm -r test
```

Expected: both packages' tests PASS (one trivial test in protocol so far). Add `"@ccferry/protocol": "workspace:*"` to `packages/client/package.json` dependencies when the client first imports it (Task 5).

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore packages docs/notes
git commit -m "chore: scaffold pnpm monorepo and protocol package" -m "- add workspace root with shared tsconfig and vitest wiring
- define shared wire types in @ccferry/protocol
- add M1 findings log skeleton"
```

---

### Task 2: Spike A — GLM endpoint inheritance

**Files:**
- Create: `packages/client/scripts/spikes/verify-glm.ts`
- Modify: `docs/notes/m1-findings.md`

**Interfaces:**
- Consumes: `@anthropic-ai/claude-agent-sdk` `query()` (installed in Task 1)
- Produces: evidence whether a plain SDK `query()` inherits the GLM endpoint configuration that the local Claude Code CLI uses.

- [ ] **Step 1: Write the spike script**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

async function main(): Promise<void> {
  for await (const message of query({ prompt: 'Reply with exactly: OK-GLM' })) {
    const msg = message as { type?: string; subtype?: string; model?: string; result?: string };
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('init model:', msg.model);
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      console.log('result:', msg.result);
    }
  }
}

main();
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @ccferry/client exec tsx scripts/spikes/verify-glm.ts
```

Expected: `result:` line printed containing `OK-GLM`. PASS = model/backend is the GLM one (any non-error reply proves the endpoint resolved; the `init model:` line documents which model string was used). FAIL (auth error / connection error) = STOP, report to the human: the daemon cannot inherit endpoint config and we must configure env explicitly before proceeding.

- [ ] **Step 3: Record the finding**

Paste the `init model:` and `result:` lines into `docs/notes/m1-findings.md` under "Spike A", mark Result as PASS or FAIL.

- [ ] **Step 4: Commit**

```bash
git add packages/client/scripts/spikes/verify-glm.ts docs/notes/m1-findings.md
git commit -m "test(spike): verify SDK inherits GLM endpoint configuration" -m "- add verify-glm spike script
- record spike A evidence in m1-findings"
```

---

### Task 3: Spike B — SDK cross-store resume

**Files:**
- Create: `packages/client/scripts/spikes/verify-resume.ts`
- Modify: `docs/notes/m1-findings.md`

**Interfaces:**
- Consumes: `query()` with `options.resume`
- Produces: evidence that an SDK query can resume a session created by another process (the foundation of "continue a TUI-started session remotely").

- [ ] **Step 1: Write the spike script**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

async function ask(prompt: string, resume?: string): Promise<{ text: string; sessionId: string }> {
  let text = '';
  let sessionId = '';
  for await (const message of query({ prompt, options: { resume } })) {
    const msg = message as { type?: string; subtype?: string; result?: string; session_id?: string };
    if (msg.type === 'result') {
      text = msg.result ?? '';
      sessionId = msg.session_id ?? '';
    }
  }
  return { text, sessionId };
}

async function main(): Promise<void> {
  const first = await ask('Remember the number 42. Reply with exactly: ACK');
  console.log('first reply:', first.text, '| session:', first.sessionId);
  if (!first.sessionId) throw new Error('no session id captured');

  const second = await ask('Which number did I ask you to remember? Reply with the number only.', first.sessionId);
  console.log('resumed reply:', second.text);
  console.log(second.text.includes('42') ? 'SPIKE-B: PASS' : 'SPIKE-B: FAIL');
}

main();
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @ccferry/client exec tsx scripts/spikes/verify-resume.ts
```

Expected: `SPIKE-B: PASS`. FAIL = STOP and report: cross-process resume is broken, which invalidates the M1 daemon's core operation.

- [ ] **Step 3: Record the finding**

Paste both replies and the session id into `docs/notes/m1-findings.md` under "Spike B".

- [ ] **Step 4: Commit**

```bash
git add packages/client/scripts/spikes/verify-resume.ts docs/notes/m1-findings.md
git commit -m "test(spike): verify SDK resume across processes" -m "- add verify-resume spike script
- record spike B evidence in m1-findings"
```

---

### Task 4: Spike C — resume fork semantics

**Files:**
- Create: `packages/client/scripts/spikes/inspect-fork.ts`
- Modify: `docs/notes/m1-findings.md`

**Interfaces:**
- Consumes: `query()`, `node:fs` directory snapshot
- Produces: the answer to "does resuming append to the same JSONL file or fork a new session id?" — this decides whether M2 needs session-lineage tracking. Run against a throwaway `cwd` (a temp dir) so real project stores stay clean.

- [ ] **Step 1: Write the spike script**

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

interface Snapshot {
  [file: string]: number;
}

async function snapshot(claudeDir: string): Promise<Snapshot> {
  const out: Snapshot = {};
  const projectsDir = path.join(claudeDir, 'projects');
  try {
    const dirs = await fs.readdir(projectsDir);
    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir);
      for (const file of await fs.readdir(dirPath)) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        out[filePath] = stat.size;
      }
    }
  } catch {
    // store not created yet
  }
  return out;
}

async function ask(prompt: string, cwd: string, resume?: string): Promise<string> {
  let sessionId = '';
  for await (const message of query({
    prompt,
    options: { cwd, resume },
  })) {
    const msg = message as { type?: string; subtype?: string; session_id?: string };
    if (msg.type === 'result') sessionId = msg.session_id ?? '';
  }
  return sessionId;
}

async function main(): Promise<void> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-fork-'));
  const claudeDir = path.join(os.homedir(), '.claude');

  const before = await snapshot(claudeDir);
  const sid1 = await ask('Reply with exactly: ONE', scratch);
  const sid2 = await ask('Reply with exactly: TWO', scratch, sid1);
  const after = await snapshot(claudeDir);

  console.log('sid1:', sid1);
  console.log('sid2:', sid2);
  console.log('same id:', sid1 === sid2);
  for (const [file, size] of Object.entries(after)) {
    const delta = size - (before[file] ?? 0);
    if (delta !== 0 || !(file in before)) {
      console.log(delta > 0 ? 'GREW' : 'NEW  ', file, `(+${size - (before[file] ?? 0)} bytes)`);
    }
  }
}

main();
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @ccferry/client exec tsx scripts/spikes/inspect-fork.ts
```

Expected: a factual printout (no PASS/FAIL — both outcomes are acceptable). Interpret:
- `same id: true` + one GREW file → resume appends in place; no lineage tracking needed.
- `same id: false` + a NEW file → resume forks; M2 must track lineage (record this).

- [ ] **Step 3: Record the finding**

Paste the output into `docs/notes/m1-findings.md` under "Spike C", state the verdict in one sentence.

- [ ] **Step 4: Commit**

```bash
git add packages/client/scripts/spikes/inspect-fork.ts docs/notes/m1-findings.md
git commit -m "test(spike): inspect resume fork semantics" -m "- add inspect-fork spike script with store snapshot diff
- record spike C verdict in m1-findings"
```

---

### Task 5: JSONL parsing + session store scanner

**Files:**
- Create: `packages/client/src/session/parse.ts`, `packages/client/src/session/parse.test.ts`
- Create: `packages/client/src/session/scanner.ts`, `packages/client/src/session/scanner.test.ts`
- Modify: `packages/client/package.json` (add `"@ccferry/protocol": "workspace:*"` dependency)

**Interfaces:**
- Consumes: `ParsedLine`, `SessionSummary`, `ProjectSummary` from `@ccferry/protocol`
- Produces:
  - `parseLine(raw: string, lineNo: number): ParsedLine`
  - `extractFirstUserText(json: Record<string, unknown>): string | null`
  - `readHead(filePath: string, capBytes: number): Promise<string>`
  - `scanStore(claudeDir: string): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }>` (sessions sorted by `lastModifiedMs` desc)

- [ ] **Step 1: Write the failing parser test**

`packages/client/src/session/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractFirstUserText, parseLine } from './parse';

describe('parseLine', () => {
  it('parses a valid JSON line', () => {
    const line = parseLine('{"type":"user"}', 1);
    expect(line).toEqual({ ok: true, line: 1, json: { type: 'user' } });
  });

  it('returns ok:false for a half-written line (Review Focus 1)', () => {
    const line = parseLine('{"type":"user",', 2);
    expect(line).toEqual({ ok: false, line: 2 });
  });

  it('returns ok:false for blank and non-object lines', () => {
    expect(parseLine('', 3).ok).toBe(false);
    expect(parseLine('42', 4).ok).toBe(false);
    expect(parseLine('null', 5).ok).toBe(false);
  });
});

describe('extractFirstUserText', () => {
  it('reads string content', () => {
    const json = { type: 'user', message: { content: 'hello world' } };
    expect(extractFirstUserText(json)).toBe('hello world');
  });

  it('reads text blocks from array content', () => {
    const json = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'block text' }] },
    };
    expect(extractFirstUserText(json)).toBe('block text');
  });

  it('returns null for non-user lines', () => {
    expect(extractFirstUserText({ type: 'assistant' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/parse.test.ts
```

Expected: FAIL — `parse.ts` does not exist.

- [ ] **Step 3: Implement the parser**

`packages/client/src/session/parse.ts`:

```ts
import type { ParsedLine } from '@ccferry/protocol';

export function parseLine(raw: string, lineNo: number): ParsedLine {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, line: lineNo };
  try {
    const json: unknown = JSON.parse(trimmed);
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, line: lineNo };
    }
    return { ok: true, line: lineNo, json: json as Record<string, unknown> };
  } catch {
    return { ok: false, line: lineNo };
  }
}

export function extractFirstUserText(json: Record<string, unknown>): string | null {
  if (json['type'] !== 'user') return null;
  const message = json['message'] as { content?: unknown } | undefined;
  if (!message) return null;
  const content = message['content'];
  if (typeof content === 'string') return content.slice(0, 200);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>)['type'] === 'text') {
        const text = (block as Record<string, unknown>)['text'];
        if (typeof text === 'string' && text.trim()) return text.slice(0, 200);
      }
    }
  }
  return null;
}
```

Add to `packages/client/package.json` dependencies: `"@ccferry/protocol": "workspace:*"`, then `pnpm install`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/parse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing scanner test**

`packages/client/src/session/scanner.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHead, scanStore } from './scanner';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-scan-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSession(dirName: string, fileName: string, lines: string[]): Promise<string> {
  const dir = path.join(tmp, 'projects', dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, lines.join('\n') + '\n');
  return filePath;
}

describe('scanStore', () => {
  it('lists sessions with metadata from the store layout', async () => {
    await writeSession('D--work-proj-A', '11111111-aaaa-4bbb-8ccc-000000000001.jsonl', [
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj A', message: { content: 'fix the login bug' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
    ]);
    await writeSession('D--work-proj-A', '11111111-aaaa-4bbb-8ccc-000000000002.jsonl', [
      'not json at all',
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj A', message: { content: 'second session' } }),
    ]);
    await writeSession('D--work-proj-B', '11111111-aaaa-4bbb-8ccc-000000000003.jsonl', [
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj B', message: { content: 'proj b task' } }),
    ]);
    await fs.mkdir(path.join(tmp, 'projects', 'D--empty-proj'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'projects', 'D--work-proj-A', 'notes.txt'), 'ignore me');

    const { projects, sessions } = await scanStore(tmp);

    expect(sessions).toHaveLength(3);
    expect(projects).toHaveLength(2);
    const a = sessions.find((s) => s.sessionId.startsWith('11111111-aaaa-4bbb-8ccc-000000000001'));
    expect(a?.projectPath).toBe('D:\\work\\proj A');
    expect(a?.firstUserText).toBe('fix the login bug');
    expect(a?.file).toContain('11111111-aaaa-4bbb-8ccc-000000000001.jsonl');
    // Review Focus 1: the garbage line is skipped, summary still built from the next line
    const b = sessions.find((s) => s.sessionId.startsWith('11111111-aaaa-4bbb-8ccc-000000000002'));
    expect(b?.firstUserText).toBe('second session');
    // sorted newest first
    expect(sessions[0]!.lastModifiedMs).toBeGreaterThanOrEqual(sessions[1]!.lastModifiedMs);
  });

  it('falls back to decoded munged dir name when cwd is absent', async () => {
    await writeSession('D--work-fallback', '11111111-aaaa-4bbb-8ccc-000000000004.jsonl', [
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
    ]);
    const { sessions } = await scanStore(tmp);
    expect(sessions[0]?.projectPath).toBe('D:\\work\\fallback');
  });
});

describe('readHead', () => {
  it('caps the read at capBytes (Review Focus 2)', async () => {
    const filePath = path.join(tmp, 'big.jsonl');
    await fs.writeFile(filePath, 'x'.repeat(10_000));
    const head = await readHead(filePath, 16);
    expect(head.length).toBeLessThanOrEqual(16);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/scanner.test.ts
```

Expected: FAIL — `scanner.ts` does not exist.

- [ ] **Step 7: Implement the scanner**

`packages/client/src/session/scanner.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { extractFirstUserText, parseLine } from './parse';

const HEAD_CAP_BYTES = 64 * 1024;

export async function readHead(filePath: string, capBytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(capBytes);
    const { bytesRead } = await handle.read(buffer, 0, capBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function scanStore(claudeDir: string): Promise<{
  projects: ProjectSummary[];
  sessions: SessionSummary[];
}> {
  const projectsDir = path.join(claudeDir, 'projects');
  const sessions: SessionSummary[] = [];
  let dirEntries: Awaited<ReturnType<typeof fs.readdir>> = [];
  try {
    dirEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return { projects: [], sessions: [] };
  }
  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(projectsDir, entry.name);
    for (const fileName of await fs.readdir(dirPath)) {
      if (!fileName.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, fileName);
      const stat = await fs.stat(filePath);
      const head = await readHead(filePath, HEAD_CAP_BYTES);
      sessions.push({
        sessionId: fileName.slice(0, -'.jsonl'.length),
        projectPath: resolveProjectPath(head) ?? decodeMungedName(entry.name),
        file: filePath,
        sizeBytes: stat.size,
        lastModifiedMs: stat.mtimeMs,
        firstUserText: findFirstUserText(head) ?? '',
      });
    }
  }
  sessions.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const projects = buildProjects(sessions);
  return { projects, sessions };
}

function buildProjects(sessions: SessionSummary[]): ProjectSummary[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.projectPath, (counts.get(session.projectPath) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([projectPath, sessionCount]) => ({ projectPath, sessionCount }))
    .sort((a, b) => b.sessionCount - a.sessionCount);
}

function resolveProjectPath(head: string): string | null {
  for (const raw of head.split('\n')) {
    const parsed = parseLine(raw, 0);
    if (parsed.ok && typeof parsed.json['cwd'] === 'string') {
      return parsed.json['cwd'];
    }
  }
  return null;
}

function findFirstUserText(head: string): string | null {
  for (const raw of head.split('\n')) {
    const parsed = parseLine(raw, 0);
    if (!parsed.ok) continue;
    const text = extractFirstUserText(parsed.json);
    if (text) return text;
  }
  return null;
}

export function decodeMungedName(name: string): string {
  return name.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\');
}
```

Note: `decodeMungedName` is display-only fallback (dashes inside real directory names are indistinguishable from separators — that is why the `cwd` field wins when present).

- [ ] **Step 8: Run tests to verify they pass**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/
```

Expected: PASS (parser + scanner).

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/session packages/client/package.json pnpm-lock.yaml
git commit -m "feat(session): scan claude session store into summaries" -m "- add tolerant JSONL line parser skipping partial writes
- add head-capped store scanner with cwd-first project resolution
- wire @ccferry/protocol workspace dependency"
```

---

### Task 6: Offset-based tail streamer

**Files:**
- Create: `packages/client/src/session/tailer.ts`, `packages/client/src/session/tailer.test.ts`

**Interfaces:**
- Consumes: nothing new (node:fs)
- Produces: `tailLines(filePath: string, opts?: TailOptions): AsyncGenerator<string>` where `TailOptions = { pollMs?: number; signal?: AbortSignal; fromStart?: boolean }` — yields complete lines (CRLF stripped), never re-emits, survives truncation.

- [ ] **Step 1: Write the failing test**

`packages/client/src/session/tailer.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tailLines } from './tailer';

let tmp: string;
let filePath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-tail-'));
  filePath = path.join(tmp, 'session.jsonl');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function collectFirst(filePathToTail: string, count: number, fromStart: boolean): Promise<string[]> {
  const controller = new AbortController();
  const lines: string[] = [];
  for await (const line of tailLines(filePathToTail, { pollMs: 10, fromStart, signal: controller.signal })) {
    lines.push(line);
    if (lines.length >= count) {
      controller.abort();
      break;
    }
  }
  return lines;
}

describe('tailLines', () => {
  it('emits existing lines then follows appends', async () => {
    await fs.writeFile(filePath, 'line-1\nline-2\n');
    const pending = collectFirst(filePath, 3, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.appendFile(filePath, 'line-3\n');
    expect(await pending).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('does not emit an unterminated last line (Review Focus 5)', async () => {
    await fs.writeFile(filePath, 'line-1\nline-2'); // no trailing newline
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of tailLines(filePath, { pollMs: 10, fromStart: true, signal: controller.signal })) {
      lines.push(line);
      if (lines.length >= 1) {
        controller.abort();
        break;
      }
    }
    expect(lines).toEqual(['line-1']);
  });

  it('strips CRLF (Review Focus 5)', async () => {
    await fs.writeFile(filePath, 'win-line\r\n');
    expect(await collectFirst(filePath, 1, true)).toEqual(['win-line']);
  });

  it('resets on truncation and keeps following (Review Focus 4)', async () => {
    await fs.writeFile(filePath, 'long first content that will be truncated away\n');
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of tailLines(filePath, { pollMs: 10, fromStart: true, signal: controller.signal })) {
      lines.push(line);
      if (lines.length === 1) {
        await fs.writeFile(filePath, 'new-epoch\n'); // truncate + replace
      }
      if (lines.length >= 2) {
        controller.abort();
        break;
      }
    }
    expect(lines).toEqual(['long first content that will be truncated away', 'new-epoch']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/tailer.test.ts
```

Expected: FAIL — `tailer.ts` does not exist.

- [ ] **Step 3: Implement the tailer**

`packages/client/src/session/tailer.ts`:

```ts
import { createReadStream, promises as fs } from 'node:fs';

export interface TailOptions {
  pollMs?: number;
  signal?: AbortSignal;
  fromStart?: boolean;
}

const NEWLINE = 0x0a;

export async function* tailLines(filePath: string, opts: TailOptions = {}): AsyncGenerator<string> {
  const pollMs = opts.pollMs ?? 1000;
  let offset = opts.fromStart ? 0 : (await fs.stat(filePath)).size;
  let carry = Buffer.alloc(0);
  while (!opts.signal?.aborted) {
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      await sleep(pollMs); // file temporarily gone (rotation); wait for it
      continue;
    }
    if (size < offset) offset = 0; // truncated or rotated: re-read from the start
    if (size > offset) {
      const stream = createReadStream(filePath, { start: offset });
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        carry = carry.length === 0 ? buf : Buffer.concat([carry, buf]);
        let idx = carry.indexOf(NEWLINE);
        while (idx >= 0) {
          yield carry.subarray(0, idx).toString('utf8').replace(/\r$/, '');
          carry = carry.subarray(idx + 1);
          idx = carry.indexOf(NEWLINE);
        }
        offset += buf.length;
      }
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Note: offset accounting uses raw Buffer byte lengths (never string lengths) so multi-byte UTF-8 cannot desync the offset (Review Focus 2).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/
```

Expected: PASS (parser + scanner + tailer).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/session/tailer.ts packages/client/src/session/tailer.test.ts
git commit -m "feat(session): add offset-based JSONL tail streamer" -m "- poll tail with byte-offset accounting safe for multibyte utf8
- handle truncation reset, CRLF stripping and unterminated last lines"
```

---

### Task 7: SessionDriver abstraction + SDK driver

**Files:**
- Create: `packages/client/src/driver/driver.ts`
- Create: `packages/client/src/driver/sdk-driver.ts`
- Create: `packages/client/src/driver/fake-driver.ts`
- Create: `packages/client/src/driver/sdk-driver.test.ts`

**Interfaces:**
- Consumes: `scanStore`, `parseLine`, `tailLines` from Task 5/6; `query` from `@anthropic-ai/claude-agent-sdk`
- Produces (used by Task 8):
  - `interface SessionDriver { list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }>; streamSession(sessionId: string, opts: { fromStart: boolean; signal: AbortSignal }): AsyncGenerator<ParsedLine>; sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent>; }`
  - `interface SendMessageInput { sessionId: string | null; projectPath: string; text: string }`
  - `class SdkDriver implements SessionDriver` (constructor takes `claudeDir: string`)
  - `class FakeDriver implements SessionDriver` (test double)

- [ ] **Step 1: Define the driver interface**

`packages/client/src/driver/driver.ts`:

```ts
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';

export interface SendMessageInput {
  sessionId: string | null;
  projectPath: string;
  text: string;
}

export interface SessionDriver {
  list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }>;
  streamSession(sessionId: string, opts: { fromStart: boolean; signal: AbortSignal }): AsyncGenerator<ParsedLine>;
  sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent>;
}
```

- [ ] **Step 2: Write the failing SDK driver test**

`packages/client/src/driver/sdk-driver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SdkDriver } from './sdk-driver';

describe('SdkDriver.sendMessage', () => {
  it('maps SDK messages into DriverEvents (assistant/system/result)', async () => {
    const driver = new SdkDriver('/nonexistent');
    const events = [];
    // The private generator is exercised through the public interface; stub
    // the query layer by testing the pure mapper instead.
    const sdkMessages = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] } },
      { type: 'result', subtype: 'success', result: 'done', session_id: 'sid-1' },
      { type: 'other' },
    ];
    for (const event of mapSdkMessages(sdkMessages)) events.push(event);
    expect(events).toEqual([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', text: 'hello world' },
      { type: 'result', subtype: 'success', text: 'done', sessionId: 'sid-1' },
    ]);
  });
});

import { mapSdkMessages } from './sdk-driver';
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/driver/sdk-driver.test.ts
```

Expected: FAIL — `mapSdkMessages` not exported.

- [ ] **Step 4: Implement the SDK driver**

`packages/client/src/driver/sdk-driver.ts`:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { parseLine } from '../session/parse';
import { scanStore } from '../session/scanner';
import { tailLines } from '../session/tailer';
import type { SessionDriver, SendMessageInput } from './driver';

interface SdkMessage {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  model?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
}

export function mapSdkMessages(messages: SdkMessage[]): DriverEvent[] {
  const events: DriverEvent[] = [];
  for (const message of messages) {
    if (message.type === 'assistant') {
      const text = (message.message?.content ?? [])
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
      if (text) events.push({ type: 'assistant', text });
    } else if (message.type === 'result') {
      events.push({
        type: 'result',
        subtype: message.subtype ?? 'unknown',
        text: message.result ?? '',
        sessionId: message.session_id ?? '',
      });
    } else if (message.type === 'system') {
      events.push({ type: 'system', subtype: message.subtype ?? 'system' });
    }
  }
  return events;
}

async function denyAllTools(): Promise<{ behavior: 'deny'; message: string }> {
  // M1 safety default: the daemon never lets the model act unattended.
  // M2 replaces this with remote approval routing.
  return { behavior: 'deny', message: 'Tool use requires remote approval, which arrives in milestone M2.' };
}

export class SdkDriver implements SessionDriver {
  constructor(private readonly claudeDir: string) {}

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return scanStore(this.claudeDir);
  }

  async *streamSession(
    sessionId: string,
    opts: { fromStart: boolean; signal: AbortSignal },
  ): AsyncGenerator<ParsedLine> {
    const file = await this.findSessionFile(sessionId);
    let lineNo = 0;
    for await (const raw of tailLines(file, {
      fromStart: opts.fromStart,
      signal: opts.signal,
      pollMs: 1000,
    })) {
      lineNo += 1;
      yield parseLine(raw, lineNo);
    }
  }

  async *sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent> {
    for await (const message of query({
      prompt: input.text,
      options: {
        resume: input.sessionId ?? undefined,
        cwd: input.projectPath,
        canUseTool: denyAllTools,
      },
    })) {
      const [event] = mapSdkMessages([message as SdkMessage]);
      if (event) yield event;
    }
  }

  private async findSessionFile(sessionId: string): Promise<string> {
    const { sessions } = await this.list();
    const hit = sessions.find((session) => session.sessionId === sessionId);
    if (!hit) throw new Error(`session not found: ${sessionId}`);
    return hit.file;
  }
}
```

`packages/client/src/driver/fake-driver.ts`:

```ts
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import type { SessionDriver, SendMessageInput } from './driver';

export class FakeDriver implements SessionDriver {
  constructor(
    private readonly projects: ProjectSummary[] = [],
    private readonly sessions: SessionSummary[] = [],
    private readonly lines: ParsedLine[] = [],
    private readonly events: DriverEvent[] = [],
  ) {}

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return { projects: this.projects, sessions: this.sessions };
  }

  async *streamSession(): AsyncGenerator<ParsedLine> {
    for (const line of this.lines) yield line;
  }

  async *sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent> {
    yield { type: 'system', subtype: 'init' };
    yield { type: 'assistant', text: `echo:${input.text}` };
    yield {
      type: 'result',
      subtype: 'success',
      text: `echo:${input.text}`,
      sessionId: input.sessionId ?? 'new-session',
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @ccferry/client exec vitest run src/driver/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/driver
git commit -m "feat(driver): add SessionDriver abstraction and SDK driver" -m "- map SDK messages into wire DriverEvents
- default deny-all canUseTool until remote approval lands in M2
- add FakeDriver test double for API tests"
```

---

### Task 8: Fastify API with SSE endpoints + active-session guard

**Files:**
- Create: `packages/client/src/api/server.ts`, `packages/client/src/api/server.test.ts`
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: `SessionDriver`, `FakeDriver` from Task 7
- Produces: `buildServer(driver: SessionDriver): FastifyInstance` with routes:
  - `GET /api/projects` → `{ projects: ProjectSummary[] }`
  - `GET /api/sessions` → `SessionSummary[]`
  - `GET /api/sessions/:id/stream?fromStart=true|false` → SSE of `ParsedLine`
  - `POST /api/sessions/:id/messages` body `{ text: string; force?: boolean }` → SSE of `DriverEvent`, or `409 { error: 'session_active', lastModifiedMs }`, or `400`, `404`
  - `main.ts` starts the daemon on `127.0.0.1:8787` (env `CCFERRY_PORT` overrides)

- [ ] **Step 1: Write the failing API test**

`packages/client/src/api/server.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@ccferry/protocol';
import { FakeDriver } from '../driver/fake-driver';
import { buildServer } from './server';

const NOW = Date.now();

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: '11111111-aaaa-4bbb-8ccc-000000000001',
    projectPath: 'D:\\work\\proj A',
    file: 'D:\\fake\\11111111-aaaa-4bbb-8ccc-000000000001.jsonl',
    sizeBytes: 100,
    lastModifiedMs: NOW - 10 * 60 * 1000,
    firstUserText: 'hello',
    ...overrides,
  };
}

describe('api server', () => {
  it('GET /api/projects returns project summaries', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: [{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }] });
  });

  it('GET /api/sessions returns session summaries', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]?.sessionId).toBe('11111111-aaaa-4bbb-8ccc-000000000001');
  });

  it('GET /api/sessions/:id/stream emits SSE data lines', async () => {
    const app = buildServer(
      new FakeDriver([], [], [{ ok: true, line: 1, json: { type: 'user' } }]),
    );
    const res = await app.inject({ method: 'GET', url: '/api/sessions/sid-1/stream?fromStart=true' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"ok":true,"line":1,"json":{"type":"user"}}');
  });

  it('POST messages returns 409 session_active for a recently modified session (Review Focus 3)', async () => {
    const app = buildServer(new FakeDriver([], [session({ lastModifiedMs: NOW - 1000 })]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'session_active' });
  });

  it('POST messages resumes and streams DriverEvents when idle', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('echo:hi');
  });

  it('POST messages with force bypasses the active guard', async () => {
    const app = buildServer(new FakeDriver([], [session({ lastModifiedMs: NOW - 1000 })]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi', force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('echo:hi');
  });

  it('POST messages returns 400 without text and 404 for unknown sessions', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const missing = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/sessions/does-not-exist/messages',
      payload: { text: 'hi' },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/api/server.test.ts
```

Expected: FAIL — `server.ts` does not exist.

- [ ] **Step 3: Implement the server**

`packages/client/src/api/server.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';

const ACTIVE_WINDOW_MS = 120_000;

export function buildServer(driver: SessionDriver): FastifyInstance {
  const app = require('fastify')();
  // ESM note: use `import Fastify from 'fastify'` at the top instead of require.
  return app;
}
```

Replace that skeleton wholesale with:

```ts
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { SessionDriver } from '../driver/driver';

const ACTIVE_WINDOW_MS = 120_000;

export function buildServer(driver: SessionDriver): FastifyInstance {
  const app = Fastify();

  app.get('/api/projects', async () => driver.list().then((r) => ({ projects: r.projects })));

  app.get('/api/sessions', async () => (await driver.list()).sessions);

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { fromStart?: string };
    startSse(reply.raw);
    const controller = new AbortController();
    req.raw.on('close', () => controller.abort());
    try {
      for await (const line of driver.streamSession(id, {
        fromStart: query.fromStart === 'true',
        signal: controller.signal,
      })) {
        reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    } finally {
      reply.raw.end();
    }
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { text?: string; force?: boolean };
    if (!body.text) return reply.code(400).send({ error: 'text required' });
    const { sessions } = await driver.list();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return reply.code(404).send({ error: 'session not found' });
    if (Date.now() - session.lastModifiedMs < ACTIVE_WINDOW_MS && !body.force) {
      return reply.code(409).send({ error: 'session_active', lastModifiedMs: session.lastModifiedMs });
    }
    startSse(reply.raw);
    try {
      for await (const event of driver.sendMessage({
        sessionId: id,
        projectPath: session.projectPath,
        text: body.text,
      })) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      reply.raw.end();
    }
  });

  return app;
}

function startSse(raw: ServerResponse): void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}
```

(Delete the skeleton block; ship only the final version.)

`packages/client/src/main.ts`:

```ts
import os from 'node:os';
import path from 'node:path';
import { SdkDriver } from './driver/sdk-driver';
import { buildServer } from './api/server';

const port = Number(process.env['CCFERRY_PORT'] ?? 8787);
const claudeDir = path.join(os.homedir(), '.claude');

const app = buildServer(new SdkDriver(claudeDir));
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`ccferry daemon listening on http://127.0.0.1:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @ccferry/client exec vitest run src/
pnpm -r typecheck
```

Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/api packages/client/src/main.ts
git commit -m "feat(api): add localhost SSE API with active-session guard" -m "- add project/session/stream/message routes over SessionDriver
- guard resume behind 120s activity window with explicit force override
- wire main.ts daemon entry on 127.0.0.1:8787"
```

---

### Task 9: End-to-end smoke against the real store

**Files:**
- Modify: `docs/notes/m1-findings.md` (E2E section appended)
- No production code expected; fix-forward if smoke reveals defects.

**Interfaces:**
- Consumes: the running daemon from Task 8
- Produces: recorded evidence that M1 works against the real `~/.claude/projects` store.

- [ ] **Step 1: Start the daemon**

```bash
pnpm --filter @ccferry/client start
```

Expected log: `ccferry daemon listening on http://127.0.0.1:8787`.

- [ ] **Step 2: Verify listing against the real store**

```bash
curl -s http://127.0.0.1:8787/api/projects | head -c 2000
```

Expected: real project paths (including the vault and dev projects). Record the project count.

- [ ] **Step 3: Verify live streaming**

Pick the newest session id from `/api/sessions`, then:

```bash
curl -sN "http://127.0.0.1:8787/api/sessions/<SESSION_ID>/stream?fromStart=true" | head -c 1000
```

Expected: SSE `data:` lines with parsed JSONL events.

- [ ] **Step 4: Verify resume on an idle session (force if recently touched)**

```bash
curl -sN -X POST "http://127.0.0.1:8787/api/sessions/<SESSION_ID>/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"Reply with exactly: CC-SMOKE-OK","force":true}' | tail -c 1000
```

Expected: SSE stream containing `assistant` text `CC-SMOKE-OK` and a `result` event. Then re-list sessions: a JSONL file for that session must have grown.

- [ ] **Step 5: Record evidence and close M1**

Append an "E2E smoke" section to `docs/notes/m1-findings.md` with: project count, streamed sample, resume reply, file-growth evidence. Mark M1 done in the vault task page (`工作任务/待办/2026-09-25-ClaudeCode远程交互系统.md`) — note that page lives in the vault repo and is auto-committed by obsidian-git.

- [ ] **Step 6: Commit**

```bash
git add docs/notes/m1-findings.md
git commit -m "docs: record M1 end-to-end smoke evidence" -m "- verify listing, live streaming and resume against the real store
- close milestone M1"
```
