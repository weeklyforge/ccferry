# ccferry M2 Implementation Plan (LAN PWA + approval routing + vault service)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship M2 per the spec: token-authenticated LAN daemon with SSE approval routing (60s fail-closed), a sandboxed vault knowledge-base service (pure-JS search), and a Vant PWA (overview / live session + approval cards / vault / settings).

**Architecture:** Extends the M1 Fastify daemon (`packages/client`) with an in-memory `ApprovalBroker` wired into `canUseTool`, a `src/vault/` service behind a path sandbox, new route families (`/api/approvals/*`, `/api/vault/*`, `POST /api/messages`), token auth + conditional LAN bind, and a third workspace package `packages/pwa` whose built `dist/` the daemon serves statically. The `SessionDriver` interface does not change.

**Tech Stack:** Node >= 20, pnpm workspaces, TypeScript strict, Fastify, vitest (co-located), Vue 3 + Vite + Vant 4 + Pinia + vue-router + vite-plugin-pwa.

**Spec:** `docs/superpowers/specs/2026-09-26-m2-lan-pwa-vault-design.md` (authority; decisions D1-D6 live there)

## Global Constraints

- Code and code comments in English only; PWA UI copy may be Chinese.
- Never hardcode tokens or machine-specific absolute paths in source; token comes from env (`CCFERRY_TOKEN`), vault path from `~/.ccferry/config.json`.
- Red line preserved: 120s activity window + explicit `force` on `POST /api/sessions/:id/messages`.
- Approval is fail-closed: timeout → deny. No new binary dependencies (pure-JS discipline, D2).
- Commits: conventional subject + markdown bullet body; no `Co-Authored-By`; never push.
- Tests: vitest, co-located `*.test.ts`. Root suite: `pnpm -r test`.
- Do not copy anything from the vault's credentials sections into this repo.
- `buildServer` keeps its existing routes and SSE-comment behavior for the stream route; only the messages route error output changes (to a `DriverEvent` error line).

## Review Focus

Failure modes the spec implies but happy-path tests miss — each pinned by a test in its owning task:

1. **Windows sandbox escape** (`..\`, `C:`, absolute, embedded `..` segment) → `resolveInside` returns null → route answers 400 `path_escape`; nothing outside the vault root is ever touched. Pinned in Task 6 (escape matrix test).
2. **Approval timeout while phone is offline / double decision race** → broker timer denies (fail-closed, never hangs); a second `decide` on the same id returns `already` → 409. Pinned in Task 3 (timer + double-decide tests).
3. **Tokenless start must refuse LAN bind** even when `CCFERRY_HOST=0.0.0.0` is set. Pinned in Task 9 (`computeBindHost` test).
4. **SSE reconnect mid-pending** → a second `GET /api/approvals/stream` receives the snapshot again; approvals are neither lost nor duplicated. Pinned in Task 5 (sequential-connect test).
5. **Huge tool input (e.g. Write with whole file content)** → broker truncates per-string 1KB / total 16KB before broadcast so the phone is not flooded. Pinned in Task 3 (truncation test).

Also pinned (not in the top five): empty/blank search query returns `200 []` (Task 7), and non-`.md` note paths are rejected 400 by vault routes (Task 8).

---

### Task 1: Protocol M2 types + ParsedLine raw passthrough

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/index.test.ts`
- Modify: `packages/client/src/session/parse.ts`
- Modify: `packages/client/src/session/parse.test.ts`

**Interfaces:**
- Consumes: M1 types (`ParsedLine`, `DriverEvent`, `SessionSummary`, `ProjectSummary`, `StreamMessage`)
- Produces: `ParsedLine` failure variant `{ ok: false; line: number; raw: string }`; `DriverEvent` gains `{ type: 'error'; message: string }`; new `ToolApprovalRequest`, `ApprovalDecision`, `VaultNode`, `VaultSearchMatch`. `parseLine(raw, lineNo)` now returns `raw` on failure.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/src/index.test.ts` (replace whole file):

```ts
import { describe, expect, it } from 'vitest';
import type {
  ApprovalDecision,
  DriverEvent,
  ParsedLine,
  ToolApprovalRequest,
  VaultNode,
  VaultSearchMatch,
} from './index';

describe('protocol types', () => {
  it('accepts a well-formed ParsedLine', () => {
    const line: ParsedLine = { ok: true, line: 1, json: { type: 'user' } };
    expect(line.ok).toBe(true);
  });

  it('accepts a failed ParsedLine carrying the raw text', () => {
    const line: ParsedLine = { ok: false, line: 2, raw: '{"type":"user",' };
    expect(line.ok).toBe(false);
  });

  it('accepts the error DriverEvent variant', () => {
    const event: DriverEvent = { type: 'error', message: 'boom' };
    expect(event.type).toBe('error');
  });

  it('accepts approval and vault wire shapes', () => {
    const request: ToolApprovalRequest = {
      approvalId: 'a1',
      sessionId: null,
      toolName: 'Bash',
      input: { command: 'ls' },
      createdAtMs: 1,
      timeoutMs: 60000,
    };
    const decision: ApprovalDecision = 'allow';
    const node: VaultNode = { name: 'n', path: 'n', kind: 'dir', children: [] };
    const match: VaultSearchMatch = { path: 'n/a.md', line: 3, text: 'hit' };
    expect([request, decision, node, match]).toHaveLength(4);
  });
});
```

`packages/client/src/session/parse.test.ts` — update the failure assertions to expect `raw`:

```ts
import { describe, expect, it } from 'vitest';
import { extractFirstUserText, parseLine } from './parse';

describe('parseLine', () => {
  it('parses a valid JSON line', () => {
    const line = parseLine('{"type":"user"}', 1);
    expect(line).toEqual({ ok: true, line: 1, json: { type: 'user' } });
  });

  it('returns ok:false with the raw text for a half-written line (Review Focus 1)', () => {
    const line = parseLine('{"type":"user",', 2);
    expect(line).toEqual({ ok: false, line: 2, raw: '{"type":"user",' });
  });

  it('returns ok:false for blank and non-object lines', () => {
    expect(parseLine('', 3)).toEqual({ ok: false, line: 3, raw: '' });
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

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @ccferry/protocol exec vitest run src/index.test.ts
pnpm --filter @ccferry/client exec vitest run src/session/parse.test.ts
```

Expected: protocol test FAILS to compile (`raw` not assignable); client test FAILS (`toEqual` mismatch — no `raw` in actual).

- [ ] **Step 3: Implement**

`packages/protocol/src/index.ts` — replace the `ParsedLine` and `DriverEvent` definitions and append the new types (rest of the file unchanged):

```ts
export type ParsedLine =
  | { ok: true; line: number; json: Record<string, unknown> }
  | { ok: false; line: number; raw: string };

export type DriverEvent =
  | { type: 'assistant'; text: string }
  | { type: 'system'; subtype: string }
  | { type: 'result'; subtype: string; text: string; sessionId: string }
  | { type: 'error'; message: string };

export type ApprovalDecision = 'allow' | 'deny';

export interface ToolApprovalRequest {
  approvalId: string;
  sessionId: string | null;
  toolName: string;
  input: Record<string, unknown>;
  createdAtMs: number;
  timeoutMs: number;
}

export interface VaultNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  sizeBytes?: number;
  children?: VaultNode[];
}

export interface VaultSearchMatch {
  path: string;
  line: number;
  text: string;
}
```

`packages/client/src/session/parse.ts` — carry `raw` through every failure return:

```ts
import type { ParsedLine } from '@ccferry/protocol';

export function parseLine(raw: string, lineNo: number): ParsedLine {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, line: lineNo, raw };
  try {
    const json: unknown = JSON.parse(trimmed);
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, line: lineNo, raw };
    }
    return { ok: true, line: lineNo, json: json as Record<string, unknown> };
  } catch {
    return { ok: false, line: lineNo, raw };
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

- [ ] **Step 4: Run the suites to verify green**

```bash
pnpm -r test
pnpm -r typecheck
```

Expected: all PASS, typecheck clean (client scanner tests don't assert the failure shape, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/client/src/session/parse.ts packages/client/src/session/parse.test.ts
git commit -m "feat(protocol): add M2 wire types and raw passthrough" -m "- carry raw text on failed ParsedLine per spec R1
- add DriverEvent error variant for semantic error surfacing
- add ToolApprovalRequest, ApprovalDecision, VaultNode, VaultSearchMatch"
```

---

### Task 2: Daemon config loader (`~/.ccferry/config.json`)

**Files:**
- Create: `packages/client/src/config.ts`
- Create: `packages/client/src/config.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `interface DaemonConfig { vaultPath?: string; toolWhitelist: string[]; approvalTimeoutMs: number }` and `loadConfig(filePath?: string): DaemonConfig` (default path: `path.join(os.homedir(), '.ccferry', 'config.json')`). Missing file or invalid JSON → defaults (`{ toolWhitelist: DEFAULT_TOOL_WHITELIST, approvalTimeoutMs: 60000 }`, no vaultPath) with a `console.error` warning on invalid JSON.

- [ ] **Step 1: Write the failing test**

`packages/client/src/config.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

let tmp: string;
let configFile: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-cfg-'));
  configFile = path.join(tmp, 'config.json');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults when the file is missing', () => {
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBeUndefined();
    expect(config.toolWhitelist).toEqual(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite']);
    expect(config.approvalTimeoutMs).toBe(60000);
  });

  it('loads values from the file', async () => {
    await fs.writeFile(configFile, JSON.stringify({
      vaultPath: 'D:/some/vault',
      toolWhitelist: ['Read'],
      approvalTimeoutMs: 30000,
    }));
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBe('D:/some/vault');
    expect(config.toolWhitelist).toEqual(['Read']);
    expect(config.approvalTimeoutMs).toBe(30000);
  });

  it('falls back to defaults on invalid JSON', async () => {
    await fs.writeFile(configFile, '{ not json');
    const config = loadConfig(configFile);
    expect(config.toolWhitelist).toEqual(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite']);
    expect(config.approvalTimeoutMs).toBe(60000);
  });

  it('merges partial files with defaults', async () => {
    await fs.writeFile(configFile, JSON.stringify({ vaultPath: 'D:/v' }));
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBe('D:/v');
    expect(config.approvalTimeoutMs).toBe(60000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/config.test.ts
```

Expected: FAIL — `./config` does not exist.

- [ ] **Step 3: Implement**

`packages/client/src/config.ts`:

```ts
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOL_WHITELIST } from './approval/policy';

export interface DaemonConfig {
  vaultPath?: string;
  toolWhitelist: string[];
  approvalTimeoutMs: number;
}

export function loadConfig(filePath?: string): DaemonConfig {
  const file = filePath ?? path.join(os.homedir(), '.ccferry', 'config.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`ccferry: ignoring invalid config file ${file}:`, error);
    }
    raw = {};
  }
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    vaultPath: typeof source['vaultPath'] === 'string' ? source['vaultPath'] : undefined,
    toolWhitelist: Array.isArray(source['toolWhitelist'])
      ? source['toolWhitelist'].filter((entry): entry is string => typeof entry === 'string')
      : [...DEFAULT_TOOL_WHITELIST],
    approvalTimeoutMs:
      typeof source['approvalTimeoutMs'] === 'number' && source['approvalTimeoutMs'] > 0
        ? source['approvalTimeoutMs']
        : 60_000,
  };
}
```

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/config.test.ts
```

Expected: PASS (this task's suites; the file imports `DEFAULT_TOOL_WHITELIST` which arrives in Task 3 — to keep this task independently green, define the constant locally first and let Task 3 own the policy module: use `const DEFAULT_TOOL_WHITELIST = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];` at the top of config.ts in this task, and Task 3's step re-exports it from `approval/policy` and updates the import).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/config.ts packages/client/src/config.test.ts
git commit -m "feat(client): load daemon config from ~/.ccferry/config.json" -m "- read vaultPath, toolWhitelist and approvalTimeoutMs with safe defaults
- degrade to defaults on missing or invalid config file"
```

---

### Task 3: Approval policy + ApprovalBroker

**Files:**
- Create: `packages/client/src/approval/policy.ts`, `packages/client/src/approval/policy.test.ts`
- Create: `packages/client/src/approval/broker.ts`, `packages/client/src/approval/broker.test.ts`
- Modify: `packages/client/src/config.ts` (switch local constant to the policy module's export)

**Interfaces:**
- Consumes: `ToolApprovalRequest`, `ApprovalDecision` from `@ccferry/protocol`
- Produces:
  - `DEFAULT_TOOL_WHITELIST: readonly string[]`
  - `evaluateToolPolicy(toolName: string, whitelist: readonly string[]): 'allow' | 'ask'`
  - `type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string }`
  - `truncateInput(input: Record<string, unknown>): Record<string, unknown>` (per-string 1KB, total 16KB)
  - `class ApprovalBroker` with `requestApproval({ sessionId, toolName, input }): Promise<PermissionResult>`, `decide(approvalId, decision): 'applied' | 'already' | 'unknown'`, `listPending(): ToolApprovalRequest[]`, `subscribe(listener): () => void`, `subscriberCount(): number`; constructor `new ApprovalBroker({ timeoutMs } = {})`

- [ ] **Step 1: Write the failing tests**

`packages/client/src/approval/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_WHITELIST, evaluateToolPolicy } from './policy';

describe('evaluateToolPolicy', () => {
  it('allows whitelisted readonly tools', () => {
    for (const tool of DEFAULT_TOOL_WHITELIST) {
      expect(evaluateToolPolicy(tool, DEFAULT_TOOL_WHITELIST)).toBe('allow');
    }
  });

  it('asks for everything else', () => {
    expect(evaluateToolPolicy('Bash', DEFAULT_TOOL_WHITELIST)).toBe('ask');
    expect(evaluateToolPolicy('Write', DEFAULT_TOOL_WHITELIST)).toBe('ask');
    expect(evaluateToolPolicy('read', DEFAULT_TOOL_WHITELIST)).toBe('ask'); // case-sensitive
  });
});
```

`packages/client/src/approval/broker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApprovalBroker, truncateInput } from './broker';

describe('truncateInput (Review Focus 5)', () => {
  it('caps long string values at 1KB', () => {
    const input = { command: 'x'.repeat(5000) };
    const out = truncateInput(input);
    const value = out['command'] as string;
    expect(value.length).toBeLessThan(1200);
    expect(value).toContain('(+');
  });

  it('caps the whole payload at 16KB total', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) input[`k${i}`] = 'y'.repeat(900);
    const serialized = JSON.stringify(truncateInput(input));
    expect(serialized.length).toBeLessThanOrEqual(17_000);
    expect(JSON.parse(serialized)).toHaveProperty('_ccferryTruncated');
  });
});

describe('ApprovalBroker', () => {
  it('denies on timeout (fail-closed, Review Focus 2)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 40 });
    const outcome = await broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: {} });
    expect(outcome).toEqual({ behavior: 'deny', message: expect.stringContaining('timeout') });
    expect(broker.listPending()).toHaveLength(0);
  });

  it('resolves on decision and rejects a second decision', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    const pending = broker.requestApproval({ sessionId: 's1', toolName: 'Write', input: { p: 1 } });
    const [request] = broker.listPending();
    expect(request?.toolName).toBe('Write');
    expect(broker.decide(request!.approvalId, 'allow')).toBe('applied');
    expect(await pending).toEqual({ behavior: 'allow' });
    expect(broker.decide(request!.approvalId, 'deny')).toBe('already');
    expect(broker.decide('no-such-id', 'deny')).toBe('unknown');
  });

  it('notifies subscribers and reports subscriber count', () => {
    const broker = new ApprovalBroker();
    const seen: string[] = [];
    const unsubscribe = broker.subscribe((request) => seen.push(request.toolName));
    expect(broker.subscriberCount()).toBe(1);
    void broker.requestApproval({ sessionId: null, toolName: 'Bash', input: {} });
    expect(seen).toEqual(['Bash']);
    unsubscribe();
    expect(broker.subscriberCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/client exec vitest run src/approval/
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`packages/client/src/approval/policy.ts`:

```ts
// Unattended default: read-only tools pass, everything else needs remote approval.
export const DEFAULT_TOOL_WHITELIST: readonly string[] = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];

export function evaluateToolPolicy(toolName: string, whitelist: readonly string[]): 'allow' | 'ask' {
  return whitelist.includes(toolName) ? 'allow' : 'ask';
}
```

`packages/client/src/approval/broker.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ToolApprovalRequest } from '@ccferry/protocol';

export type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string };

const STRING_VALUE_CAP = 1024;
const TOTAL_CAP = 16 * 1024;

export function truncateInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > STRING_VALUE_CAP) {
      out[key] = `${value.slice(0, STRING_VALUE_CAP)}…(+${value.length - STRING_VALUE_CAP} chars)`;
    } else {
      out[key] = value;
    }
  }
  if (JSON.stringify(out).length > TOTAL_CAP) {
    return { _ccferryTruncated: true, preview: JSON.stringify(out).slice(0, TOTAL_CAP) };
  }
  return out;
}

interface PendingEntry {
  request: ToolApprovalRequest;
  resolve: (result: PermissionResult) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly settled = new Set<string>();
  private readonly listeners = new Set<(request: ToolApprovalRequest) => void>();

  constructor(private readonly opts: { timeoutMs?: number } = {}) {}

  requestApproval(input: {
    sessionId: string | null;
    toolName: string;
    input: Record<string, unknown>;
  }): Promise<PermissionResult> {
    const timeoutMs = this.opts.timeoutMs ?? 60_000;
    const request: ToolApprovalRequest = {
      approvalId: randomUUID(),
      sessionId: input.sessionId,
      toolName: input.toolName,
      input: truncateInput(input.input),
      createdAtMs: Date.now(),
      timeoutMs,
    };
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.settle(request.approvalId, {
          behavior: 'deny',
          message: `approval timeout (${Math.round(timeoutMs / 1000)}s) — denied by default`,
        });
      }, timeoutMs);
      this.pending.set(request.approvalId, { request, resolve, timer });
      for (const listener of this.listeners) listener(request);
    });
  }

  decide(approvalId: string, decision: ApprovalDecision): 'applied' | 'already' | 'unknown' {
    if (decision !== 'allow' && decision !== 'deny') return 'unknown';
    if (this.settled.has(approvalId)) return 'already';
    const result: PermissionResult =
      decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'denied remotely' };
    return this.settle(approvalId, result) ? 'applied' : 'unknown';
  }

  listPending(): ToolApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  subscribe(listener: (request: ToolApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  private settle(approvalId: string, result: PermissionResult): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    this.settled.add(approvalId);
    entry.resolve(result);
    return true;
  }
}
```

In `packages/client/src/config.ts`: delete the local `DEFAULT_TOOL_WHITELIST` constant and change the import to `import { DEFAULT_TOOL_WHITELIST } from './approval/policy';` (run `pnpm --filter @ccferry/client exec vitest run src/config.test.ts src/approval/` — still green).

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/approval/ src/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/approval packages/client/src/config.ts
git commit -m "feat(approval): add tool policy and in-memory approval broker" -m "- allow whitelisted read-only tools unattended, ask otherwise
- fail-closed 60s timeout with single-decision 409 semantics
- truncate tool input before broadcast (1KB per string, 16KB total)"
```

---

### Task 4: SdkDriver wiring (broker + whitelist) and scan TTL cache

**Files:**
- Create: `packages/client/src/session/scan-cache.ts`, `packages/client/src/session/scan-cache.test.ts`
- Modify: `packages/client/src/driver/sdk-driver.ts`
- Modify: `packages/client/src/main.ts` (composition only — no behavioral change to bind yet)

**Interfaces:**
- Consumes: `ApprovalBroker`, `PermissionResult`, `evaluateToolPolicy`, `DEFAULT_TOOL_WHITELIST`, `scanStore`
- Produces:
  - `cachedScan(claudeDir: string, ttlMs: number, scan: typeof scanStore = scanStore): typeof scanStore`
  - `interface SdkDriverOptions { broker?: ApprovalBroker; whitelist?: readonly string[]; scan?: typeof scanStore }`
  - `new SdkDriver(claudeDir, options?)` — `canUseTool` now: whitelist → allow; else broker (deny-all if no broker configured)

- [ ] **Step 1: Write the failing tests**

`packages/client/src/session/scan-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { cachedScan } from './scan-cache';

const result: { projects: ProjectSummary[]; sessions: SessionSummary[] } = { projects: [], sessions: [] };

function makeCountingScan(): { scan: () => Promise<typeof result>; calls: () => number } {
  let calls = 0;
  return {
    async scan() {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

describe('cachedScan', () => {
  it('serves repeated calls from cache within the TTL', async () => {
    const counter = makeCountingScan();
    const scan = cachedScan('/fake', 1000, counter.scan as never);
    await scan('/fake');
    await scan('/fake');
    await scan('/fake');
    expect(counter.calls()).toBe(1);
  });

  it('re-invokes after the TTL expires', async () => {
    const counter = makeCountingScan();
    const scan = cachedScan('/fake', 20, counter.scan as never);
    await scan('/fake');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scan('/fake');
    expect(counter.calls()).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/session/scan-cache.test.ts
```

Expected: FAIL — `./scan-cache` does not exist.

- [ ] **Step 3: Implement**

`packages/client/src/session/scan-cache.ts`:

```ts
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { scanStore } from './scanner';

export type ScanResult = { projects: ProjectSummary[]; sessions: SessionSummary[] };
export type ScanFn = (claudeDir: string) => Promise<ScanResult>;

export function cachedScan(claudeDir: string, ttlMs: number, scan: ScanFn = scanStore): ScanFn {
  let cached: { at: number; value: ScanResult } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await scan(claudeDir);
    cached = { at: Date.now(), value };
    return value;
  };
}
```

`packages/client/src/driver/sdk-driver.ts` — replace the `denyAllTools` function and constructor, and rewire `sendMessage` (everything else in the file unchanged):

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { parseLine } from '../session/parse';
import { scanStore } from '../session/scanner';
import type { ScanFn } from '../session/scan-cache';
import { tailLines } from '../session/tailer';
import type { PermissionResult } from '../approval/broker';
import type { ApprovalBroker } from '../approval/broker';
import { DEFAULT_TOOL_WHITELIST, evaluateToolPolicy } from '../approval/policy';
import type { SessionDriver, SendMessageInput } from './driver';

export interface SdkDriverOptions {
  broker?: ApprovalBroker;
  whitelist?: readonly string[];
  scan?: ScanFn;
}
```

```ts
export class SdkDriver implements SessionDriver {
  private readonly whitelist: readonly string[];
  private readonly scan: ScanFn;
  private currentSessionId: string | null = null;

  constructor(
    private readonly claudeDir: string,
    private readonly options: SdkDriverOptions = {},
  ) {
    this.whitelist = options.whitelist ?? DEFAULT_TOOL_WHITELIST;
    this.scan = options.scan ?? scanStore;
  }

  private readonly canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    if (evaluateToolPolicy(toolName, this.whitelist) === 'allow') {
      return { behavior: 'allow' };
    }
    if (!this.options.broker) {
      // No broker configured (unit contexts): stay fail-closed like M1.
      return { behavior: 'deny', message: 'Tool use requires remote approval; no approval broker is configured.' };
    }
    return this.options.broker.requestApproval({
      sessionId: this.currentSessionId,
      toolName,
      input,
    });
  };

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return this.scan(this.claudeDir);
  }
```

(``findSessionFile`` stays as-is — it now benefits from the cached `list()`; `streamSession` unchanged; `sendMessage` gains two lines: set `this.currentSessionId = input.sessionId;` at the top, and inside the message loop capture ids: `if (msg.session_id) this.currentSessionId = msg.session_id;` — full updated `sendMessage`:)

```ts
  async *sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent> {
    this.currentSessionId = input.sessionId;
    for await (const message of query({
      prompt: input.text,
      options: {
        resume: input.sessionId ?? undefined,
        cwd: input.projectPath,
        canUseTool: this.canUseTool,
      },
    })) {
      const msg = message as SdkMessage & { session_id?: string };
      if (msg.session_id) this.currentSessionId = msg.session_id;
      const [event] = mapSdkMessages([msg]);
      if (event) yield event;
    }
  }
```

`packages/client/src/main.ts` — composition only (still localhost, no token yet):

```ts
import os from 'node:os';
import path from 'node:path';
import { SdkDriver } from './driver/sdk-driver';
import { ApprovalBroker } from './approval/broker';
import { loadConfig } from './config';
import { cachedScan } from './session/scan-cache';
import { buildServer } from './api/server';

const config = loadConfig();
const port = Number(process.env['CCFERRY_PORT'] ?? 8787);
const claudeDir = path.join(os.homedir(), '.claude');
const broker = new ApprovalBroker({ timeoutMs: config.approvalTimeoutMs });

const app = buildServer(
  new SdkDriver(claudeDir, {
    broker,
    whitelist: config.toolWhitelist,
    scan: cachedScan(claudeDir, 5000),
  }),
  { broker, logger: true },
);
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`ccferry daemon listening on http://127.0.0.1:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

(Note: `buildServer(driver, { broker, logger: true })` requires the Task 5 signature change — implement Tasks 4 and 5's signature together if executing sequentially and the typecheck gate complains; the safe order is: Task 4 keeps `buildServer(new SdkDriver(...))` without options, and Task 5 introduces the options object. Follow that: in THIS task write `buildServer(new SdkDriver(claudeDir, { broker, whitelist, scan: cachedScan(claudeDir, 5000) }));` only.)

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/
pnpm -r typecheck
```

Expected: PASS (driver test's `new SdkDriver('/nonexistent')` still compiles — options optional).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/session/scan-cache.ts packages/client/src/session/scan-cache.test.ts packages/client/src/driver/sdk-driver.ts packages/client/src/main.ts
git commit -m "feat(driver): wire approval broker into canUseTool and cache scans" -m "- whitelist readonly tools, route the rest through ApprovalBroker
- track current session id for approval attribution
- add 5s TTL scan cache to absorb phone polling"
```

---

### Task 5: SSE helper + approval API routes + messages-route error event

**Files:**
- Create: `packages/client/src/api/sse.ts`
- Create: `packages/client/src/api/approval-routes.ts`, `packages/client/src/api/approval-routes.test.ts`
- Modify: `packages/client/src/api/server.ts` (extract `startSse`, options-object signature, error event in messages route)
- Modify: `packages/client/src/api/server.test.ts` (error-comment assertion → error event; buildServer calls unchanged)
- Modify: `packages/client/src/main.ts` (adopt `buildServer(driver, { broker, logger: true })`)

**Interfaces:**
- Consumes: `ApprovalBroker`, `ToolApprovalRequest`, `DriverEvent`
- Produces:
  - `startSse(raw: ServerResponse): void` (moved to `sse.ts`)
  - `registerApprovalRoutes(app: FastifyInstance, broker: ApprovalBroker): void` with `GET /api/approvals`, `GET /api/approvals/stream`, `POST /api/approvals/:id/decision`
  - `buildServer(driver: SessionDriver, opts: { logger?: boolean; broker?: ApprovalBroker } = {}): FastifyInstance` — messages route now emits `data: {"type":"error","message":...}` on driver throw (stream route keeps the M1 SSE comment)

- [ ] **Step 1: Write the failing tests**

`packages/client/src/api/approval-routes.test.ts`:

```ts
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../approval/broker';
import { registerApprovalRoutes } from './approval-routes';

function app(broker: ApprovalBroker) {
  const instance = Fastify();
  registerApprovalRoutes(instance, broker);
  return instance;
}

describe('approval routes', () => {
  it('GET /api/approvals lists pending requests', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: { command: 'ls' } });
    const res = await app(broker).inject({ method: 'GET', url: '/api/approvals' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ approvals: [{ toolName: 'Bash', sessionId: 's1' }] });
  });

  it('POST decision applies, then 409 on repeat (Review Focus 2)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: null, toolName: 'Write', input: {} });
    const [{ approvalId }] = broker.listPending();
    const instance = app(broker);
    const first = await instance.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      payload: { decision: 'allow' },
    });
    expect(first.statusCode).toBe(200);
    const second = await instance.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      payload: { decision: 'deny' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'already_decided' });
  });

  it('POST decision validates the decision value', async () => {
    const res = await app(new ApprovalBroker()).inject({
      method: 'POST',
      url: '/api/approvals/x/decision',
      payload: { decision: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stream redelivers the pending snapshot on reconnect (Review Focus 4)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    void broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: {} });
    const [{ approvalId }] = broker.listPending();
    const instance = app(broker);
    const first = await instance.inject({ method: 'GET', url: '/api/approvals/stream' });
    const second = await instance.inject({ method: 'GET', url: '/api/approvals/stream' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('text/event-stream');
    expect(first.body).toContain('"toolName":"Bash"');
    expect(second.body).toContain('"toolName":"Bash"'); // snapshot survives reconnect
    broker.decide(approvalId, 'deny'); // settle so the test process can exit cleanly
  });
});
```

In `packages/client/src/api/server.test.ts`, update the mid-stream POST error assertion:

```ts
  it('POST messages surfaces a mid-stream driver error as an error event', async () => {
    const app = buildServer(new ThrowingSendDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/11111111-aaaa-4bbb-8ccc-000000000001/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: {"type":"error","message":"send boom"}');
  });
```

(The GET-stream error test keeps asserting the `: ccferry error:` comment — that route is unchanged.)

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/client exec vitest run src/api/
```

Expected: FAIL — `./approval-routes` does not exist; error-event test FAILS (comment instead of data line).

- [ ] **Step 3: Implement**

`packages/client/src/api/sse.ts`:

```ts
import type { ServerResponse } from 'node:http';

export function startSse(raw: ServerResponse): void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}
```

`packages/client/src/api/approval-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ApprovalBroker } from '../approval/broker';
import { startSse } from './sse';

const KEEPALIVE_MS = 15_000;

export function registerApprovalRoutes(app: FastifyInstance, broker: ApprovalBroker): void {
  app.get('/api/approvals', async () => ({ approvals: broker.listPending() }));

  app.get('/api/approvals/stream', async (req, reply) => {
    startSse(reply.raw);
    for (const request of broker.listPending()) {
      reply.raw.write(`data: ${JSON.stringify(request)}\n\n`);
    }
    const unsubscribe = broker.subscribe((request) => {
      reply.raw.write(`data: ${JSON.stringify(request)}\n\n`);
    });
    const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), KEEPALIVE_MS);
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(keepalive);
    });
  });

  app.post('/api/approvals/:id/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { decision?: string };
    if (body.decision !== 'allow' && body.decision !== 'deny') {
      return reply.code(400).send({ error: 'decision must be allow or deny' });
    }
    const outcome = broker.decide(id, body.decision);
    if (outcome === 'applied') return { ok: true };
    if (outcome === 'already') return reply.code(409).send({ error: 'already_decided' });
    return reply.code(404).send({ error: 'unknown approval' });
  });
}
```

`packages/client/src/api/server.ts` — full replacement:

```ts
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import type { ApprovalBroker } from '../approval/broker';
import { registerApprovalRoutes } from './approval-routes';
import { startSse } from './sse';

const ACTIVE_WINDOW_MS = 120_000;

// The daemon binds to 127.0.0.1; also demand a loopback Host header so a
// visited website cannot reach it through DNS rebinding (which would make
// the request same-origin and skip the browser's CSRF preflight).
// With a token configured (Task 9) the token becomes the gate instead.
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

export interface ServerOptions {
  logger?: boolean;
  broker?: ApprovalBroker;
}

export function buildServer(driver: SessionDriver, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.addHook('onRequest', async (req, reply) => {
    const hostname = req.hostname.replace(/^\[|\]$/g, '');
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'host not allowed' });
    }
  });

  app.get('/api/projects', async () => driver.list().then((r) => ({ projects: r.projects })));

  app.get('/api/sessions', async () => (await driver.list()).sessions);

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sessions } = await driver.list();
    if (!sessions.some((session) => session.sessionId === id)) {
      return reply.code(404).send({ error: 'session not found' });
    }
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
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'session stream failed');
      reply.raw.write(`: ccferry error: ${errorMessage(error)}\n\n`);
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
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'send message failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage(error) })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  if (opts.broker) registerApprovalRoutes(app, opts.broker);

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

`packages/client/src/main.ts` — switch to the options call:

```ts
const app = buildServer(
  new SdkDriver(claudeDir, {
    broker,
    whitelist: config.toolWhitelist,
    scan: cachedScan(claudeDir, 5000),
  }),
  { broker, logger: true },
);
```

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/
pnpm -r typecheck
```

Expected: PASS (14 client files' worth of suites; the M1 `buildServer(driver, true)` call sites do not exist — M1 tests call `buildServer(driver)`).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/api packages/client/src/main.ts
git commit -m "feat(api): add approval routes and error DriverEvent" -m "- SSE snapshot + live approval stream with 15s keepalive
- decision endpoint with 400/404/409 semantics
- emit typed error events from the messages route"
```

---

### Task 6: Vault sandbox + tree + note file ops

**Files:**
- Create: `packages/client/src/vault/sandbox.ts`, `packages/client/src/vault/sandbox.test.ts`
- Create: `packages/client/src/vault/tree.ts`, `packages/client/src/vault/tree.test.ts`
- Create: `packages/client/src/vault/files.ts`, `packages/client/src/vault/files.test.ts`

**Interfaces:**
- Consumes: `VaultNode` from `@ccferry/protocol`
- Produces:
  - `resolveInside(root: string, relPath: string): string | null`
  - `IGNORED_DIRS: Set<string>` (`'.git' | '.obsidian' | 'node_modules'`)
  - `readTree(root: string): Promise<VaultNode[]>`
  - `readNote(root, relPath): Promise<{ status: 'ok'; content: string } | { status: 'escape' | 'missing' }>`
  - `writeNote(root, relPath, content): Promise<'escape' | 'missing' | 'ok'>`
  - `createNote(root, relPath, content): Promise<'escape' | 'exists' | 'created'>` (creates parent dirs)

- [ ] **Step 1: Write the failing tests**

`packages/client/src/vault/sandbox.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from './sandbox';

const ROOT = path.resolve('/vault-root');

describe('resolveInside (Review Focus 1)', () => {
  it('resolves a normal relative path', () => {
    expect(resolveInside(ROOT, '工作日报/2026-09/a.md')).toBe(path.join(ROOT, '工作日报', '2026-09', 'a.md'));
  });

  it('accepts backslash separators but rejects escapes', () => {
    expect(resolveInside(ROOT, 'dir\\file.md')).toBe(path.join(ROOT, 'dir', 'file.md'));
  });

  it('rejects traversal, absolute and drive-letter paths', () => {
    expect(resolveInside(ROOT, '../outside.md')).toBeNull();
    expect(resolveInside(ROOT, 'dir/../../outside.md')).toBeNull();
    expect(resolveInside(ROOT, '..\\outside.md')).toBeNull();
    expect(resolveInside(ROOT, '/etc/passwd')).toBeNull();
    expect(resolveInside(ROOT, 'C:/windows/system32')).toBeNull();
    expect(resolveInside(ROOT, 'C:\\windows')).toBeNull();
  });

  it('rejects empty paths and the root itself', () => {
    expect(resolveInside(ROOT, '')).toBeNull();
    expect(resolveInside(ROOT, '.')).toBeNull();
  });
});
```

`packages/client/src/vault/tree.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTree } from './tree';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-vault-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('readTree', () => {
  it('builds nested nodes and skips ignored dirs', async () => {
    await fs.mkdir(path.join(root, '日报', '2026-09'), { recursive: true });
    await fs.writeFile(path.join(root, '日报', '2026-09', 'a.md'), 'hello');
    await fs.writeFile(path.join(root, 'top.md'), 'x');
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'config'), 'x');
    const tree = await readTree(root);
    expect(tree.map((n) => n.path).sort()).toEqual(['top.md', '日报']);
    const dir = tree.find((n) => n.kind === 'dir');
    expect(dir?.children?.[0]).toMatchObject({ path: '日报/2026-09', kind: 'dir' });
    const file = dir?.children?.[0]?.children?.[0];
    expect(file).toMatchObject({ path: '日报/2026-09/a.md', kind: 'file', sizeBytes: 5 });
  });
});
```

`packages/client/src/vault/files.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNote, readNote, writeNote } from './files';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-files-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('note file ops', () => {
  it('create → read → write round-trip, creating parent dirs', async () => {
    expect(await createNote(root, '笔记/新.md', '# new')).toBe('created');
    expect(await createNote(root, '笔记/新.md', '# again')).toBe('exists');
    const read = await readNote(root, '笔记/新.md');
    expect(read).toMatchObject({ status: 'ok', content: '# new' });
    expect(await writeNote(root, '笔记/新.md', '# edited')).toBe('ok');
    expect(await readNote(root, '笔记/新.md')).toMatchObject({ content: '# edited' });
  });

  it('reports missing and escape statuses', async () => {
    expect(await readNote(root, 'nope.md')).toMatchObject({ status: 'missing' });
    expect(await writeNote(root, 'nope.md', 'x')).toBe('missing');
    expect(await readNote(root, '../escape.md')).toMatchObject({ status: 'escape' });
    expect(await writeNote(root, '../escape.md', 'x')).toBe('escape');
    expect(await createNote(root, '../escape.md', 'x')).toBe('escape');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/client exec vitest run src/vault/
```

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`packages/client/src/vault/sandbox.ts`:

```ts
import path from 'node:path';

// Single entry point for every vault file operation: resolve a vault-relative
// path against the root, or return null when it would escape the root.
export function resolveInside(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath === '') return null;
  const normalized = relPath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return null;
  if (segments.length === 0) return null; // the root itself is not a note path
  const abs = path.resolve(root, ...segments);
  const rel = path.relative(path.resolve(root), abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}
```

`packages/client/src/vault/tree.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultNode } from '@ccferry/protocol';

export const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules']);

export async function readTree(root: string): Promise<VaultNode[]> {
  return walk(root, '');
}

async function walk(dir: string, prefix: string): Promise<VaultNode[]> {
  let entries: Awaited<ReturnType<typeof fs.readdir>> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  const nodes: VaultNode[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, kind: 'dir', children: await walk(path.join(dir, entry.name), rel) });
    } else if (entry.isFile()) {
      const stat = await fs.stat(path.join(dir, entry.name));
      nodes.push({ name: entry.name, path: rel, kind: 'file', sizeBytes: stat.size });
    }
  }
  return nodes;
}
```

`packages/client/src/vault/files.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveInside } from './sandbox';

export type ReadNoteResult = { status: 'ok'; content: string } | { status: 'escape' | 'missing' };

export async function readNote(root: string, relPath: string): Promise<ReadNoteResult> {
  const abs = resolveInside(root, relPath);
  if (!abs) return { status: 'escape' };
  try {
    return { status: 'ok', content: await fs.readFile(abs, 'utf8') };
  } catch {
    return { status: 'missing' };
  }
}

export async function writeNote(root: string, relPath: string, content: string): Promise<'escape' | 'missing' | 'ok'> {
  const abs = resolveInside(root, relPath);
  if (!abs) return 'escape';
  try {
    await fs.access(abs);
  } catch {
    return 'missing';
  }
  await fs.writeFile(abs, content, 'utf8');
  return 'ok';
}

export async function createNote(root: string, relPath: string, content: string): Promise<'escape' | 'exists' | 'created'> {
  const abs = resolveInside(root, relPath);
  if (!abs) return 'escape';
  try {
    await fs.access(abs);
    return 'exists';
  } catch {
    // not found — create it (with parent directories, Obsidian-style)
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return 'created';
}
```

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/vault/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/vault
git commit -m "feat(vault): add path sandbox, tree reader and note file ops" -m "- resolveInside rejects traversal, absolute and drive-letter paths
- readTree skips .git/.obsidian/node_modules
- create/read/write note operations with parent-dir creation"
```

---

### Task 7: Vault search engine (pure JS)

**Files:**
- Create: `packages/client/src/vault/search.ts`, `packages/client/src/vault/search.test.ts`

**Interfaces:**
- Consumes: `readTree` from `./tree`, `VaultSearchMatch` from `@ccferry/protocol`
- Produces: `interface SearchEngine { search(root: string, query: string): Promise<VaultSearchMatch[]> }` and `createJsSearchEngine(): SearchEngine` — case-insensitive literal substring, `.md` files only, per-file cap 20, global cap 200, line text truncated to 200 chars, blank query → `[]`.

- [ ] **Step 1: Write the failing test**

`packages/client/src/vault/search.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsSearchEngine } from './search';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-search-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createJsSearchEngine', () => {
  it('finds case-insensitive literal matches with line numbers', async () => {
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(path.join(root, 'notes', 'a.md'), 'nothing\nSmart Heating here\n');
    await fs.writeFile(path.join(root, 'b.md'), 'smart heating again\n');
    const engine = createJsSearchEngine();
    const matches = await engine.search(root, 'smart heating');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ path: 'notes/a.md', line: 2, text: 'Smart Heating here' });
  });

  it('returns an empty array for a blank query', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'smart');
    expect(await createJsSearchEngine().search(root, '   ')).toEqual([]);
  });

  it('ignores non-md files and caps long lines', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'smart heating');
    await fs.writeFile(path.join(root, 'a.md'), 'x'.repeat(500) + ' smart heating');
    const matches = await createJsSearchEngine().search(root, 'smart heating');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.text.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @ccferry/client exec vitest run src/vault/search.test.ts
```

Expected: FAIL — `./search` does not exist.

- [ ] **Step 3: Implement**

`packages/client/src/vault/search.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultNode, VaultSearchMatch } from '@ccferry/protocol';
import { readTree } from './tree';

export interface SearchEngine {
  search(root: string, query: string): Promise<VaultSearchMatch[]>;
}

const MAX_PER_FILE = 20;
const MAX_TOTAL = 200;
const LINE_TRUNCATE = 200;

// Pure-JS engine: the measured vault is ~317 md files / ~481KB, so a full
// scan per query lands in the tens of milliseconds. Swapping in ripgrep
// later means implementing this interface only (spec D2).
export function createJsSearchEngine(): SearchEngine {
  return {
    async search(root: string, query: string): Promise<VaultSearchMatch[]> {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const matches: VaultSearchMatch[] = [];
      for (const abs of await collectMdFiles(root)) {
        if (matches.length >= MAX_TOTAL) break;
        let perFile = 0;
        let lineNo = 0;
        const content = await fs.readFile(abs, 'utf8');
        for (const line of content.split('\n')) {
          lineNo += 1;
          if (line.toLowerCase().includes(needle)) {
            matches.push({
              path: toRelative(root, abs),
              line: lineNo,
              text: line.slice(0, LINE_TRUNCATE),
            });
            perFile += 1;
            if (perFile >= MAX_PER_FILE) break;
          }
        }
      }
      return matches.slice(0, MAX_TOTAL);
    },
  };
}

async function collectMdFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(nodes: VaultNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.kind === 'file' && node.name.endsWith('.md')) files.push(path.join(root, node.path));
      if (node.children) await visit(node.children);
    }
  }
  await visit(await readTree(root));
  return files;
}

function toRelative(root: string, abs: string): string {
  return abs.slice(path.resolve(root).length + 1).replaceAll('\\', '/');
}
```

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/vault/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/vault/search.ts packages/client/src/vault/search.test.ts
git commit -m "feat(vault): add pure-JS search engine behind SearchEngine" -m "- case-insensitive literal substring over md files
- per-file 20 / global 200 caps with 200-char line truncation
- engine interface keeps the ripgrep upgrade path open"
```

---

### Task 8: Vault API routes + new-session route (`POST /api/messages`)

**Files:**
- Create: `packages/client/src/api/vault-routes.ts`, `packages/client/src/api/vault-routes.test.ts`
- Modify: `packages/client/src/api/server.ts` (register vault routes + messages route via options)
- Modify: `packages/client/src/main.ts` (pass `vaultRoot` from config)
- Modify: `packages/client/src/api/server.test.ts` (buildServer signature stays compatible; add one registration smoke if desired — covered by vault-routes tests instead)

**Interfaces:**
- Consumes: `readTree`, `readNote`, `writeNote`, `createNote`, `createJsSearchEngine`, `startSse`, `SessionDriver`
- Produces: `registerVaultRoutes(app, vaultRoot: string | null): void` with `GET /api/vault/tree`, `GET /api/vault/file`, `PUT /api/vault/file`, `POST /api/vault/file`, `GET /api/vault/search`; `registerNewSessionRoute(app, driver)` with `POST /api/messages`; `ServerOptions` gains `vaultRoot?: string | null`. All vault routes answer 503 `{ error: 'vault_not_configured' }` when root is null; non-`.md` note paths answer 400 `{ error: 'only .md notes' }`.

- [ ] **Step 1: Write the failing tests**

`packages/client/src/api/vault-routes.test.ts`:

```ts
import Fastify from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerVaultRoutes } from './vault-routes';

let root: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-vaultapi-'));
  app = Fastify();
  registerVaultRoutes(app, root);
});

afterEach(async () => {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('vault routes', () => {
  it('lists the tree', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'x');
    const res = await app.inject({ method: 'GET', url: '/api/vault/tree' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ root, tree: [{ path: 'a.md', kind: 'file' }] });
  });

  it('reads, writes and creates notes', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'old');
    const read = await app.inject({ method: 'GET', url: '/api/vault/file?path=a.md' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ path: 'a.md', content: 'old' });

    const put = await app.inject({ method: 'PUT', url: '/api/vault/file', payload: { path: 'a.md', content: 'new' } });
    expect(put.statusCode).toBe(200);

    const post = await app.inject({ method: 'POST', url: '/api/vault/file', payload: { path: 'dir/b.md', content: '# b' } });
    expect(post.statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/api/vault/file', payload: { path: 'dir/b.md', content: '# b' } });
    expect(again.statusCode).toBe(409);
  });

  it('answers 400 for escapes and non-md paths, 404 for missing', async () => {
    const escape = await app.inject({ method: 'GET', url: '/api/vault/file?path=../x.md' });
    expect(escape.statusCode).toBe(400);
    expect(escape.json()).toEqual({ error: 'path_escape' });
    const txt = await app.inject({ method: 'PUT', url: '/api/vault/file', payload: { path: 'a.txt', content: 'x' } });
    expect(txt.statusCode).toBe(400);
    const missing = await app.inject({ method: 'GET', url: '/api/vault/file?path=nope.md' });
    expect(missing.statusCode).toBe(404);
  });

  it('searches and validates q', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'smart heating\n');
    const hit = await app.inject({ method: 'GET', url: '/api/vault/search?q=heating' });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toEqual({ matches: [{ path: 'a.md', line: 1, text: 'smart heating' }] });
    const blank = await app.inject({ method: 'GET', url: '/api/vault/search?q=' });
    expect(blank.statusCode).toBe(400);
  });

  it('answers 503 when the vault is not configured', async () => {
    const unconfigured = Fastify();
    registerVaultRoutes(unconfigured, null);
    const res = await unconfigured.inject({ method: 'GET', url: '/api/vault/tree' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'vault_not_configured' });
    await unconfigured.close();
  });
});
```

In `packages/client/src/api/server.test.ts`, add a new-session route test:

```ts
  it('POST /api/messages starts a new session and streams DriverEvents', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: { projectPath: 'D:\\work\\proj A', text: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('echo:hello');
    expect(res.body).toContain('"sessionId":"new-session"');
  });

  it('POST /api/messages validates the body', async () => {
    const app = buildServer(new FakeDriver([], [session()]));
    const res = await app.inject({ method: 'POST', url: '/api/messages', payload: { projectPath: 'D:\\x' } });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/client exec vitest run src/api/
```

Expected: FAIL — `./vault-routes` does not exist; `/api/messages` 404s.

- [ ] **Step 3: Implement**

`packages/client/src/api/vault-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { createJsSearchEngine } from '../vault/search';
import { createNote, readNote, writeNote } from '../vault/files';
import { readTree } from '../vault/tree';

const engine = createJsSearchEngine();

export function registerVaultRoutes(app: FastifyInstance, vaultRoot: string | null): void {
  app.get('/api/vault/tree', async (_req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    return { root, tree: await readTree(root) };
  });

  app.get('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: 'path required' });
    const outcome = await readNote(root, relPath);
    if (outcome.status === 'escape') return reply.code(400).send({ error: 'path_escape' });
    if (outcome.status === 'missing') return reply.code(404).send({ error: 'note not found' });
    return { path: relPath, content: outcome.content };
  });

  app.put('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const body = (req.body ?? {}) as { path?: string; content?: string };
    if (!body.path || typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'path and content required' });
    }
    if (!body.path.endsWith('.md')) return reply.code(400).send({ error: 'only .md notes' });
    const outcome = await writeNote(root, body.path, body.content);
    if (outcome === 'escape') return reply.code(400).send({ error: 'path_escape' });
    if (outcome === 'missing') return reply.code(404).send({ error: 'note not found' });
    return { ok: true };
  });

  app.post('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const body = (req.body ?? {}) as { path?: string; content?: string };
    if (!body.path) return reply.code(400).send({ error: 'path required' });
    if (!body.path.endsWith('.md')) return reply.code(400).send({ error: 'only .md notes' });
    const outcome = await createNote(root, body.path, body.content ?? '');
    if (outcome === 'escape') return reply.code(400).send({ error: 'path_escape' });
    if (outcome === 'exists') return reply.code(409).send({ error: 'note exists' });
    return reply.code(201).send({ ok: true });
  });

  app.get('/api/vault/search', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const { q } = req.query as { q?: string };
    if (!q || !q.trim()) return reply.code(400).send({ error: 'q required' });
    return { matches: await engine.search(root, q) };
  });
}

function requireRoot(vaultRoot: string | null, reply: { code(c: number): { send(body: unknown): unknown } }): string | null {
  if (!vaultRoot) {
    void reply.code(503).send({ error: 'vault_not_configured' });
    return null;
  }
  return vaultRoot;
}
```

(```requireRoot``` uses Fastify's chainable reply; type it loosely as above or import `FastifyReply`.)

In `packages/client/src/api/server.ts`: extend `ServerOptions` with `vaultRoot?: string | null`, and after the approval registration add:

```ts
import { registerVaultRoutes } from './vault-routes';
import { registerNewSessionRoute } from './new-session-route';
// inside buildServer, after registerApprovalRoutes:
  registerVaultRoutes(app, opts.vaultRoot ?? null);
  registerNewSessionRoute(app, driver);
```

Create `packages/client/src/api/new-session-route.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import { startSse } from './sse';

// Opens a brand-new session (sessionId null) in the given project. This is
// the vault "agent organize" entry point: the PWA posts here with
// projectPath = vault root, and the session then shows up in the overview
// like any other (spec section 3.6).
export function registerNewSessionRoute(app: FastifyInstance, driver: SessionDriver): void {
  app.post('/api/messages', async (req, reply) => {
    const body = (req.body ?? {}) as { projectPath?: string; text?: string };
    if (!body.projectPath || !body.text) {
      return reply.code(400).send({ error: 'projectPath and text required' });
    }
    startSse(reply.raw);
    try {
      for await (const event of driver.sendMessage({
        sessionId: null,
        projectPath: body.projectPath,
        text: body.text,
      })) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      req.log.error({ err: error }, 'new session failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage(error) })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

`packages/client/src/main.ts` — pass the vault root: `buildServer(..., { broker, vaultRoot: config.vaultPath ?? null, logger: true })`.

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/api
git commit -m "feat(api): add vault routes and new-session endpoint" -m "- tree/read/write/create/search over the sandboxed vault root
- 503 when vaultPath is not configured, 400 on escapes and non-md paths
- POST /api/messages opens new sessions (vault agent entry)"
```

---

### Task 9: Token auth + LAN bind + static PWA hosting

**Files:**
- Create: `packages/client/src/api/bind.ts`, `packages/client/src/api/bind.test.ts`
- Modify: `packages/client/src/api/server.ts` (auth hook + host-gate relaxation when token set)
- Modify: `packages/client/src/api/server.test.ts` (auth tests)
- Modify: `packages/client/src/main.ts` (token/host composition + `@fastify/static`)
- Modify: `packages/client/package.json` (add `@fastify/static`)

**Interfaces:**
- Consumes: `ServerOptions`
- Produces:
  - `computeBindHost(token: string | undefined, hostEnv: string | undefined): string` — no token → always `127.0.0.1`; token → `hostEnv ?? '127.0.0.1'`
  - `ServerOptions` gains `token?: string`; when set, `/api/*` requires `Authorization: Bearer <token>` or `?token=` (SSE), and the Host allowlist is bypassed (the token is the gate). When unset, M1 loopback Host allowlist applies and no auth is required.
  - `main.ts` serves `packages/pwa/dist` (override: `CCFERRY_PWA_DIR`) with SPA fallback when the directory exists.

- [ ] **Step 1: Write the failing tests**

`packages/client/src/api/bind.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeBindHost } from './bind';

describe('computeBindHost (Review Focus 3)', () => {
  it('refuses LAN bind without a token, whatever the env says', () => {
    expect(computeBindHost(undefined, '0.0.0.0')).toBe('127.0.0.1');
    expect(computeBindHost('', '0.0.0.0')).toBe('127.0.0.1');
  });

  it('honors CCFERRY_HOST only when a token is set', () => {
    expect(computeBindHost('secret', '0.0.0.0')).toBe('0.0.0.0');
    expect(computeBindHost('secret', undefined)).toBe('127.0.0.1');
  });
});
```

In `packages/client/src/api/server.test.ts`, add (and keep every existing test — they run tokenless and must stay green):

```ts
describe('token auth', () => {
  it('rejects /api without a token when one is configured', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const denied = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer s3cret' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('accepts ?token= for SSE-style requests', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret' });
    expect(res.statusCode).toBe(200);
  });

  it('relaxes the Host allowlist when a token is configured', async () => {
    const app = buildServer(new FakeDriver([{ projectPath: 'D:\\work\\proj A', sessionCount: 1 }]), { token: 's3cret' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer s3cret', host: '192.168.1.5:8787' },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/client exec vitest run src/api/
```

Expected: FAIL — `./bind` does not exist; token tests fail (no auth yet).

- [ ] **Step 3: Implement**

`packages/client/src/api/bind.ts`:

```ts
// Without a token the daemon must never expose itself beyond loopback,
// even if CCFERRY_HOST says otherwise (spec section 5, safety default).
export function computeBindHost(token: string | undefined, hostEnv: string | undefined): string {
  if (!token) return '127.0.0.1';
  return hostEnv ?? '127.0.0.1';
}
```

`packages/client/src/api/server.ts` — replace the existing `onRequest` hook block and extend `ServerOptions`:

```ts
export interface ServerOptions {
  logger?: boolean;
  broker?: ApprovalBroker;
  vaultRoot?: string | null;
  token?: string;
}
```

```ts
  app.addHook('onRequest', async (req, reply) => {
    if (opts.token) {
      // Token mode (LAN): the token is the gate; Bearer header or ?token= (SSE).
      if (!req.url.startsWith('/api')) return; // static PWA shell stays open
      const header = req.headers['authorization'];
      const query = req.query as Record<string, unknown>;
      const provided = header === `Bearer ${opts.token}` || query['token'] === opts.token;
      if (!provided) return reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    // Tokenless mode (localhost): keep the M1 DNS-rebinding Host allowlist.
    const hostname = req.hostname.replace(/^\[|\]$/g, '');
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'host not allowed' });
    }
  });
```

`packages/client/package.json`: `pnpm --filter @ccferry/client add @fastify/static`.

`packages/client/src/main.ts` — full replacement:

```ts
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { SdkDriver } from './driver/sdk-driver';
import { ApprovalBroker } from './approval/broker';
import { loadConfig } from './config';
import { cachedScan } from './session/scan-cache';
import { computeBindHost } from './api/bind';
import { buildServer } from './api/server';

const config = loadConfig();
const port = Number(process.env['CCFERRY_PORT'] ?? 8787);
const token = process.env['CCFERRY_TOKEN'] || undefined;
const host = computeBindHost(token, process.env['CCFERRY_HOST']);
const claudeDir = path.join(os.homedir(), '.claude');
const broker = new ApprovalBroker({ timeoutMs: config.approvalTimeoutMs });

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPwaDir = path.resolve(here, '../../pwa/dist');
const pwaDir = process.env['CCFERRY_PWA_DIR'] ?? defaultPwaDir;

const app = buildServer(
  new SdkDriver(claudeDir, {
    broker,
    whitelist: config.toolWhitelist,
    scan: cachedScan(claudeDir, 5000),
  }),
  { broker, vaultRoot: config.vaultPath ?? null, token, logger: true },
);

if (existsSync(pwaDir)) {
  await app.register(fastifyStatic, { root: pwaDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  console.warn(`ccferry: PWA directory not found at ${pwaDir} — serving API only`);
}

app
  .listen({ port, host })
  .then(() => console.log(`ccferry daemon listening on http://${host}:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 4: Run to verify green**

```bash
pnpm --filter @ccferry/client exec vitest run src/
pnpm -r typecheck
```

Expected: PASS (all M1/M2 tests; the daemon start path is exercised manually in Task 13).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/api packages/client/src/main.ts packages/client/package.json pnpm-lock.yaml
git commit -m "feat(api): add token auth, conditional LAN bind and static PWA hosting" -m "- require Bearer or ?token= on /api when CCFERRY_TOKEN is set
- force loopback bind without a token regardless of CCFERRY_HOST
- serve packages/pwa/dist with SPA fallback when present"
```

---

### Task 10: PWA scaffold (`packages/pwa`)

**Files:**
- Create: `packages/pwa/package.json`, `packages/pwa/tsconfig.json`, `packages/pwa/vite.config.ts`, `packages/pwa/index.html`
- Create: `packages/pwa/src/main.ts`, `packages/pwa/src/App.vue`, `packages/pwa/src/router.ts`, `packages/pwa/src/vite-env.d.ts`
- Create: `packages/pwa/src/stores/auth.ts`, `packages/pwa/src/stores/approvals.ts`, `packages/pwa/src/stores/approvals.test.ts`
- Create: `packages/pwa/src/lib/api.ts`, `packages/pwa/src/lib/debounce.ts`, `packages/pwa/src/lib/debounce.test.ts`
- Create: `packages/pwa/src/composables/useCountdown.ts`, `packages/pwa/src/composables/useCountdown.test.ts`

**Interfaces:**
- Consumes: `ToolApprovalRequest`, `ApprovalDecision` from `@ccferry/protocol` (workspace dep)
- Produces (used by Tasks 11-12):
  - `useAuthStore()` (Pinia): `{ token: string; daemonBase: string; setToken(t: string): void; clearToken(): void }` — token persisted to `localStorage['ccferry-token']`, daemonBase = `location.origin` (settable later in Settings)
  - `apiFetch(path: string, init?: RequestInit): Promise<Response>` — adds Bearer + JSON content-type
  - `sseUrl(path: string): string` — appends `?token=`
  - `readSsePost(path: string, body: unknown, onEvent: (data: string) => void): Promise<void>` — POST + stream parse for SSE-over-POST
  - `useApprovalsStore()`: `{ pending: ToolApprovalRequest[]; ingest(req): void; decide(id, decision): Promise<void>; sweepExpired(): void }`
  - `debounce(fn, ms)` with `.cancel()`
  - `useCountdown(deadlineMs: number): { remaining: Ref<number> }`
  - Router: `/` (总览), `/session/:id` (会话流), `/vault` (知识库), `/settings` (设置)

- [ ] **Step 1: Scaffold package files**

`packages/pwa/package.json`:

```json
{
  "name": "@ccferry/pwa",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run --passWithNoTests",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@ccferry/protocol": "workspace:*",
    "pinia": "^3.0.0",
    "vant": "^4.9.0",
    "vue": "^3.5.0",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.0",
    "@vue/test-utils": "^2.4.0",
    "typescript": "^7.0.0",
    "vite": "^7.0.0",
    "vite-plugin-pwa": "^1.0.0",
    "vitest": "^5.0.0",
    "vue-tsc": "^3.0.0"
  }
}
```

`packages/pwa/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`packages/pwa/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ccferry',
        short_name: 'ccferry',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1989fa',
        icons: [],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'node' },
});
```

`packages/pwa/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>ccferry</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing logic tests**

`packages/pwa/src/lib/debounce.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('fires once after the quiet period', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel() prevents the call', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

`packages/pwa/src/composables/useCountdown.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  it('ticks down toward the deadline and clamps at zero', () => {
    const deadline = Date.now() + 5000;
    const { remaining } = useCountdown(deadline);
    expect(remaining.value).toBe(5000);
    vi.advanceTimersByTime(3000);
    expect(remaining.value).toBe(2000);
    vi.advanceTimersByTime(5000);
    expect(remaining.value).toBe(0);
  });
});
```

`packages/pwa/src/stores/approvals.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolApprovalRequest } from '@ccferry/protocol';
import { useApprovalsStore } from './approvals';

function request(id: string, ageMs = 0): ToolApprovalRequest {
  return {
    approvalId: id,
    sessionId: 's1',
    toolName: 'Bash',
    input: {},
    createdAtMs: Date.now() - ageMs,
    timeoutMs: 60000,
  };
}

describe('approvals store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('ingests without duplicating and decide removes + posts', async () => {
    const store = useApprovalsStore();
    store.ingest(request('a1'));
    store.ingest(request('a1'));
    expect(store.pending).toHaveLength(1);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await store.decide('a1', 'allow');
    expect(store.pending).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/approvals/a1/decision');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
    vi.unstubAllGlobals();
  });

  it('sweepExpired drops timed-out approvals', () => {
    const store = useApprovalsStore();
    store.ingest(request('fresh'));
    store.ingest(request('stale', 120000));
    store.sweepExpired();
    expect(store.pending.map((p) => p.approvalId)).toEqual(['fresh']);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
pnpm install
pnpm --filter @ccferry/pwa exec vitest run src/lib/debounce.test.ts src/composables src/stores
```

Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement the scaffold**

`packages/pwa/src/main.ts`:

```ts
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import 'vant/lib/index.css';

createApp(App).use(createPinia()).use(router).mount('#app');
```

`packages/pwa/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
```

`packages/pwa/src/router.ts`:

```ts
import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sessions', component: () => import('./pages/Sessions.vue') },
    { path: '/session/:id', name: 'session', component: () => import('./pages/SessionView.vue') },
    { path: '/vault', name: 'vault', component: () => import('./pages/Vault.vue') },
    { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
  ],
});
```

`packages/pwa/src/App.vue` (placeholder pages until Tasks 11-12):

```vue
<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <router-view :key="route.fullPath" />
</template>
```

`packages/pwa/src/stores/auth.ts`:

```ts
import { defineStore } from 'pinia';

const TOKEN_KEY = 'ccferry-token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: safeGet(TOKEN_KEY),
    daemonBase: typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:8787',
  }),
  actions: {
    setToken(token: string) {
      this.token = token;
      safeSet(TOKEN_KEY, token);
    },
    clearToken() {
      this.token = '';
      safeSet(TOKEN_KEY, '');
    },
  },
});

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / storage disabled — keep in-memory only
  }
}
```

`packages/pwa/src/lib/api.ts`:

```ts
import { useAuthStore } from '../stores/auth';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = useAuthStore();
  const headers = new Headers(init.headers);
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${auth.daemonBase}${path}`, { ...init, headers });
}

export function sseUrl(path: string): string {
  const auth = useAuthStore();
  const url = new URL(auth.daemonBase + path);
  if (auth.token) url.searchParams.set('token', auth.token);
  return url.toString();
}

// EventSource cannot POST; consume SSE-over-POST with a stream reader.
export async function readSsePost(path: string, body: unknown, onEvent: (data: string) => void): Promise<void> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const response = await fetch(auth.daemonBase + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) onEvent(line.slice(6));
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
```

`packages/pwa/src/lib/debounce.ts`:

```ts
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
  };
  return wrapped;
}
```

`packages/pwa/src/composables/useCountdown.ts`:

```ts
import { onUnmounted, ref } from 'vue';

export function useCountdown(deadlineMs: number, intervalMs = 1000): { remaining: ReturnType<typeof ref<number>> } {
  const remaining = ref(Math.max(0, deadlineMs - Date.now()));
  const timer = setInterval(() => {
    remaining.value = Math.max(0, deadlineMs - Date.now());
  }, intervalMs);
  onUnmounted(() => clearInterval(timer));
  return { remaining };
}
```

`packages/pwa/src/stores/approvals.ts`:

```ts
import { defineStore } from 'pinia';
import type { ApprovalDecision, ToolApprovalRequest } from '@ccferry/protocol';
import { apiFetch } from '../lib/api';

export const useApprovalsStore = defineStore('approvals', {
  state: () => ({
    pending: [] as ToolApprovalRequest[],
  }),
  actions: {
    ingest(request: ToolApprovalRequest) {
      if (!this.pending.some((p) => p.approvalId === request.approvalId)) this.pending.push(request);
    },
    async decide(approvalId: string, decision: ApprovalDecision) {
      this.pending = this.pending.filter((p) => p.approvalId !== approvalId);
      await apiFetch(`/api/approvals/${approvalId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
    },
    sweepExpired() {
      const now = Date.now();
      this.pending = this.pending.filter((p) => now - p.createdAtMs < p.timeoutMs);
    },
  },
});
```

Create empty placeholder pages so the router resolves (`packages/pwa/src/pages/Sessions.vue`, `SessionView.vue`, `Vault.vue`, `Settings.vue` — each just):

```vue
<template>
  <div class="page">placeholder</div>
</template>
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @ccferry/pwa exec vitest run src/
pnpm -r typecheck
```

Expected: PASS (3 logic suites), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/pwa pnpm-lock.yaml
git commit -m "feat(pwa): scaffold Vite + Vue 3 + Vant app shell" -m "- workspace package with PWA manifest and dev proxy to the daemon
- auth/approvals Pinia stores with token-aware fetch and SSE helpers
- debounce and countdown composables pinned by logic tests"
```

---

### Task 11: PWA 总览 + 会话流 + 批准卡

**Files:**
- Create: `packages/pwa/src/lib/session-status.ts`, `packages/pwa/src/lib/session-status.test.ts`
- Create: `packages/pwa/src/lib/bubbles.ts`, `packages/pwa/src/lib/bubbles.test.ts`
- Create: `packages/pwa/src/components/ApprovalCard.vue`
- Modify: `packages/pwa/src/pages/Sessions.vue` (replace placeholder)
- Modify: `packages/pwa/src/pages/SessionView.vue` (replace placeholder)
- Modify: `packages/pwa/src/App.vue` (Tabbar)

**Interfaces:**
- Consumes: `apiFetch`, `sseUrl`, `readSsePost`, `useApprovalsStore`, `useAuthStore`, `useCountdown`, `ParsedLine`, `SessionSummary`, `ToolApprovalRequest`, `DriverEvent`
- Produces:
  - `sessionStatus(s: SessionSummary, nowMs: number, approvals: ToolApprovalRequest[]): 'awaiting' | 'running' | 'idle'`
  - `parsedLineToBubble(p: ParsedLine): { kind: 'text'; role: 'user' | 'assistant'; text: string } | { kind: 'tool'; name: string } | { kind: 'raw'; text: string } | null`
  - UI: overview with grouped sessions + status badges + new-vault-session dialog; session page with live stream, chat input, inline approval cards

- [ ] **Step 1: Write the failing tests**

`packages/pwa/src/lib/session-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionSummary, ToolApprovalRequest } from '@ccferry/protocol';
import { sessionStatus } from './session-status';

const NOW = 100_000_000;

function session(lastModifiedMs: number): SessionSummary {
  return {
    sessionId: 's1',
    projectPath: 'p',
    file: 'f',
    sizeBytes: 1,
    lastModifiedMs,
    firstUserText: '',
  };
}

function approval(sessionId: string): ToolApprovalRequest {
  return { approvalId: 'a', sessionId, toolName: 'Bash', input: {}, createdAtMs: NOW, timeoutMs: 60000 };
}

describe('sessionStatus', () => {
  it('flags sessions with pending approvals first', () => {
    expect(sessionStatus(session(NOW - 1000), NOW, [approval('s1')])).toBe('awaiting');
  });
  it('flags recent activity as running within the 120s window', () => {
    expect(sessionStatus(session(NOW - 60_000), NOW, [])).toBe('running');
    expect(sessionStatus(session(NOW - 130_000), NOW, [])).toBe('idle');
  });
});
```

`packages/pwa/src/lib/bubbles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsedLineToBubble } from './bubbles';

describe('parsedLineToBubble', () => {
  it('maps user/assistant text lines to text bubbles', () => {
    const user = parsedLineToBubble({ ok: true, line: 1, json: { type: 'user', message: { content: 'hi' } } });
    expect(user).toEqual({ kind: 'text', role: 'user', text: 'hi' });
    const assistant = parsedLineToBubble({
      ok: true,
      line: 2,
      json: { type: 'assistant', message: { content: [{ type: 'text', text: 'bo' }] } },
    });
    expect(assistant).toEqual({ kind: 'text', role: 'assistant', text: 'bo' });
  });

  it('maps tool_use blocks to tool bubbles', () => {
    const tool = parsedLineToBubble({
      ok: true,
      line: 3,
      json: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    });
    expect(tool).toEqual({ kind: 'tool', name: 'Bash' });
  });

  it('maps failed lines to raw bubbles and skips noise', () => {
    expect(parsedLineToBubble({ ok: false, line: 4, raw: 'garbage{' })).toEqual({ kind: 'raw', text: 'garbage{' });
    expect(parsedLineToBubble({ ok: false, line: 5, raw: '' })).toBeNull();
    expect(parsedLineToBubble({ ok: true, line: 6, json: { type: 'system', subtype: 'init' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @ccferry/pwa exec vitest run src/lib/
```

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`packages/pwa/src/lib/session-status.ts`:

```ts
import type { SessionSummary, ToolApprovalRequest } from '@ccferry/protocol';

const ACTIVITY_WINDOW_MS = 120_000;

export function sessionStatus(
  s: SessionSummary,
  nowMs: number,
  approvals: ToolApprovalRequest[],
): 'awaiting' | 'running' | 'idle' {
  if (approvals.some((a) => a.sessionId === s.sessionId)) return 'awaiting';
  if (nowMs - s.lastModifiedMs < ACTIVITY_WINDOW_MS) return 'running';
  return 'idle';
}
```

`packages/pwa/src/lib/bubbles.ts`:

```ts
import type { ParsedLine } from '@ccferry/protocol';

export type Bubble =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'raw'; text: string };

export function parsedLineToBubble(p: ParsedLine): Bubble | null {
  if (!p.ok) return p.raw.trim() ? { kind: 'raw', text: p.raw.slice(0, 200) } : null;
  const json = p.json;
  const type = json['type'];
  if (type !== 'user' && type !== 'assistant') return null;
  const message = json['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.trim() ? { kind: 'text', role: type, text: content.slice(0, 2000) } : null;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['type'] === 'text' && typeof record['text'] === 'string' && record['text'].trim()) {
        return { kind: 'text', role: type, text: record['text'].slice(0, 2000) };
      }
      if (record['type'] === 'tool_use' && typeof record['name'] === 'string') {
        return { kind: 'tool', name: record['name'] };
      }
    }
  }
  return null;
}
```

`packages/pwa/src/components/ApprovalCard.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Button } from 'vant';
import type { ToolApprovalRequest } from '@ccferry/protocol';
import { useApprovalsStore } from '../stores/approvals';
import { useCountdown } from '../composables/useCountdown';

const props = defineProps<{ request: ToolApprovalRequest }>();
const approvals = useApprovalsStore();
const { remaining } = useCountdown(props.request.createdAtMs + props.request.timeoutMs);
const seconds = computed(() => Math.ceil(remaining.value / 1000));
const inputPreview = computed(() => JSON.stringify(props.request.input).slice(0, 600));
</script>

<template>
  <div class="approval-card">
    <div class="title">权限请求：{{ request.toolName }}</div>
    <pre class="input">{{ inputPreview }}</pre>
    <div class="row">
      <span class="countdown">{{ seconds }}s 后自动拒绝</span>
      <Button size="small" type="danger" plain @click="approvals.decide(request.approvalId, 'deny')">拒绝</Button>
      <Button size="small" type="primary" @click="approvals.decide(request.approvalId, 'allow')">允许</Button>
    </div>
  </div>
</template>

<style scoped>
.approval-card { border: 1px solid #ee0a24; border-radius: 8px; padding: 8px; margin: 8px 0; }
.title { font-weight: bold; }
.input { font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow: auto; }
.row { display: flex; gap: 8px; align-items: center; }
.countdown { color: #ee0a24; font-size: 12px; margin-right: auto; }
</style>
```

`packages/pwa/src/App.vue` (Tabbar + view):

```vue
<script setup lang="ts">
import { Tabbar, TabbarItem } from 'vant';
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <router-view :key="route.fullPath" />
  <Tabbar route placeholder>
    <TabbarItem replace to="/" icon="chat-o">会话</TabbarItem>
    <TabbarItem replace to="/vault" icon="notes-o">知识库</TabbarItem>
    <TabbarItem replace to="/settings" icon="setting-o">设置</TabbarItem>
  </Tabbar>
</template>
```

`packages/pwa/src/pages/Sessions.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, Collapse, CollapseItem, Dialog, PullRefresh, Tag } from 'vant';
import type { SessionSummary, ToolApprovalRequest } from '@ccferry/protocol';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useApprovalsStore } from '../stores/approvals';
import { sessionStatus } from '../lib/session-status';

const router = useRouter();
const auth = useAuthStore();
const approvals = useApprovalsStore();
const sessions = ref<SessionSummary[]>([]);
const openGroups = ref<string[]>([]);
const agentText = ref('');
let poll: ReturnType<typeof setInterval> | undefined;

const groups = computed(() => {
  const map = new Map<string, SessionSummary[]>();
  for (const s of sessions.value) {
    const list = map.get(s.projectPath) ?? [];
    list.push(s);
    map.set(s.projectPath, list);
  }
  return [...map.entries()].map(([projectPath, list]) => ({ projectPath, list }));
});

async function refresh(): Promise<void> {
  approvals.sweepExpired();
  const [sessionsRes, approvalsRes] = await Promise.all([
    apiFetch('/api/sessions'),
    apiFetch('/api/approvals'),
  ]);
  if (sessionsRes.ok) sessions.value = await sessionsRes.json();
  if (approvalsRes.ok) {
    for (const request of (await approvalsRes.json())['approvals'] as ToolApprovalRequest[]) {
      approvals.ingest(request);
    }
  }
}

function statusOf(s: SessionSummary): 'awaiting' | 'running' | 'idle' {
  return sessionStatus(s, Date.now(), approvals.pending);
}

async function startVaultSession(): Promise<void> => {
  const vaultRoot = (await (await apiFetch('/api/vault/tree')).json())['root'] as string | undefined;
  if (!vaultRoot) {
    Dialog.alert({ message: '知识库未配置（daemon 端 ~/.ccferry/config.json 缺 vaultPath）' });
    return;
  }
  await readSsePostFirst('/api/messages', { projectPath: vaultRoot, text: agentText.value || '请整理一下最近的笔记' });
  Dialog.alert({ message: '已创建 vault 会话，请在会话列表打开' });
  await refresh();
}

async function readSsePostFirst(path: string, body: unknown): Promise<void> {
  try {
    const { readSsePost } = await import('../lib/api');
    await readSsePost(path, body, () => undefined);
  } catch {
    // errors surface in the session stream itself; ignore here
  }
}

function relative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

onMounted(() => {
  void refresh();
  poll = setInterval(() => void refresh(), 10_000);
});
onUnmounted(() => poll && clearInterval(poll));
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>会话总览</h2>
      <Button size="small" @click="Dialog.confirm({ message: '向知识库发一条整理指令？' }).then(startVaultSession)">agent 整理</Button>
    </div>
    <PullRefresh :model-value="false" @update:model-value="refresh">
      <Collapse v-model="openGroups">
        <CollapseItem v-for="group in groups" :key="group.projectPath" :title="group.projectPath" :name="group.projectPath">
          <Cell
            v-for="s in group.list"
            :key="s.sessionId"
            :title="s.firstUserText || '(无摘要)'"
            :label="relative(s.lastModifiedMs)"
            is-link
            @click="router.push(`/session/${s.sessionId}`)"
          >
            <template #value>
              <Tag v-if="statusOf(s) === 'awaiting'" type="danger">等你批准</Tag>
              <Tag v-else-if="statusOf(s) === 'running'" type="primary">进行中</Tag>
              <Tag v-else plain>空闲</Tag>
            </template>
          </Cell>
        </CollapseItem>
      </Collapse>
    </PullRefresh>
  </div>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; }
h2 { font-size: 16px; margin: 0; }
</style>
```

`packages/pwa/src/pages/SessionView.vue`:

```vue
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Field } from 'vant';
import type { DriverEvent, ParsedLine, ToolApprovalRequest } from '@ccferry/protocol';
import { readSsePost, sseUrl } from '../lib/api';
import { useApprovalsStore } from '../stores/approvals';
import { parsedLineToBubble } from '../lib/bubbles';

const route = useRoute();
const sessionId = route.params['id'] as string;
const approvals = useApprovalsStore();
const bubbles = ref<ReturnType<typeof parsedLineToBubble>[]>([]);
const errors = ref<string[]>([]);
const input = ref('');
const sending = ref(false);
let stream: EventSource | undefined;
let bottom: HTMLElement | undefined;

function pushBubble(line: ParsedLine): void {
  const bubble = parsedLineToBubble(line);
  if (bubble) bubbles.value.push(bubble);
  void nextTick(() => bottom?.scrollIntoView({ behavior: 'smooth' }));
}

function handleApprovalEvent(data: string): void {
  try {
    approvals.ingest(JSON.parse(data) as ToolApprovalRequest);
  } catch {
    // malformed frame — ignore
  }
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  input.value = '';
  bubbles.value.push({ kind: 'text', role: 'user', text });
  try {
    await readSsePost(`/api/sessions/${sessionId}/messages`, { text, force: false }, (data) => {
      const event = JSON.parse(data) as DriverEvent;
      if (event.type === 'error') errors.value.push(event.message);
      else if (event.type === 'assistant') bubbles.value.push({ kind: 'text', role: 'assistant', text: event.text });
    });
  } catch (error) {
    errors.value.push(String(error));
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  stream = new EventSource(sseUrl(`/api/sessions/${sessionId}/stream?fromStart=true`));
  stream.onmessage = (event) => pushBubble(JSON.parse(event.data) as ParsedLine);
  const approvalsStream = new EventSource(sseUrl('/api/approvals/stream'));
  approvalsStream.onmessage = (event) => handleApprovalEvent(event.data);
  streamCleanup = () => approvalsStream.close();
});
let streamCleanup: (() => void) | undefined;
onUnmounted(() => {
  stream?.close();
  streamCleanup?.();
});
</script>

<template>
  <div class="page session">
    <div class="stream">
      <div v-for="(bubble, i) in bubbles" :key="i" :class="['bubble', bubble?.kind === 'text' ? bubble.role : bubble?.kind]">
        <template v-if="bubble?.kind === 'text'">{{ bubble.text }}</template>
        <template v-else-if="bubble?.kind === 'tool'">🔧 {{ bubble.name }}</template>
        <template v-else-if="bubble?.kind === 'raw'">{{ bubble.text }}</template>
      </div>
      <ApprovalCard
        v-for="request in approvals.pending.filter((p) => !p.sessionId || p.sessionId === sessionId)"
        :key="request.approvalId"
        :request="request"
      />
      <div v-for="error in errors" :key="error" class="error">{{ error }}</div>
      <div ref="bottom" />
    </div>
    <div class="composer">
      <Field v-model="input" placeholder="续聊…" rows="1" autosize />
      <Button type="primary" :loading="sending" @click="send">发送</Button>
    </div>
  </div>
</template>

<style scoped>
.session { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.stream { flex: 1; overflow-y: auto; padding: 12px; }
.bubble { margin: 6px 0; padding: 8px 12px; border-radius: 8px; background: #f2f3f5; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: #1989fa; color: white; }
.bubble.tool { background: #fffbe8; font-size: 12px; }
.bubble.raw { background: #f7f7f7; color: #969799; font-size: 12px; }
.error { color: #ee0a24; font-size: 12px; }
.composer { display: flex; gap: 8px; padding: 8px; align-items: center; }
</style>
```

(Add `import ApprovalCard from '../components/ApprovalCard.vue';` at the top of SessionView's script block.)

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @ccferry/pwa exec vitest run src/
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pwa
git commit -m "feat(pwa): add session overview, live stream and approval cards" -m "- grouped overview with awaiting/running/idle badges and 10s polling
- live session page with bubbles, tool cards and SSE reconnection
- inline approval card with countdown and allow/deny actions"
```

---

### Task 12: PWA 知识库 + 设置

**Files:**
- Modify: `packages/pwa/src/pages/Vault.vue` (replace placeholder)
- Modify: `packages/pwa/src/pages/Settings.vue` (replace placeholder)
- Create: `packages/pwa/src/components/NoteEditor.vue`

**Interfaces:**
- Consumes: `apiFetch`, `debounce`, `useAuthStore`, `VaultNode`, `VaultSearchMatch`
- Produces: vault page (drill-down list + search + note editor + create + agent entry), settings page (token set/clear, daemon base, vault status)

- [ ] **Step 1: Implement the pages** (UI pages are manually accepted in Task 13; the pure logic they consume is already pinned by Tasks 7/10/11 tests)

`packages/pwa/src/pages/Vault.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, NavBar, Search, Toast } from 'vant';
import type { VaultNode, VaultSearchMatch } from '@ccferry/protocol';
import NoteEditor from '../components/NoteEditor.vue';
import { apiFetch } from '../lib/api';
import { debounce } from '../lib/debounce';

const router = useRouter();
const stack = ref<VaultNode[][]>([]);
const title = ref('知识库');
const query = ref('');
const matches = ref<VaultSearchMatch[] | null>(null);
const editing = ref<string | null>(null);
const creating = ref(false);
const newNotePath = ref('');

const current = () => stack.value[stack.value.length - 1] ?? [];

async function openRoot(): Promise<void> {
  const res = await apiFetch('/api/vault/tree');
  if (res.status === 503) {
    title.value = '知识库（未配置）';
    stack.value = [];
    return;
  }
  const body = await res.json();
  stack.value = [body['tree'] as VaultNode[]];
}

function enter(node: VaultNode): void {
  if (node.kind === 'dir') {
    stack.value.push(node.children ?? []);
    title.value = node.name;
    matches.value = null;
  } else {
    editing.value = node.path;
  }
}

function back(): void {
  if (editing.value !== null) {
    editing.value = null;
    return;
  }
  if (creating.value) {
    creating.value = false;
    return;
  }
  if (matches.value !== null) {
    matches.value = null;
    return;
  }
  if (stack.value.length > 1) {
    stack.value.pop();
    title.value = stack.value.length > 1 ? '…' : '知识库';
  } else {
    router.back();
  }
}

const runSearch = debounce(async (q: string) => {
  if (!q.trim()) {
    matches.value = null;
    return;
  }
  const res = await apiFetch(`/api/vault/search?q=${encodeURIComponent(q)}`);
  if (res.ok) matches.value = (await res.json())['matches'] as VaultSearchMatch[];
}, 300);

async function createNote(): Promise<void> {
  const path = newNotePath.value.trim();
  if (!path.endsWith('.md')) {
    Toast.fail('路径必须以 .md 结尾');
    return;
  }
  const res = await apiFetch('/api/vault/file', { method: 'POST', body: JSON.stringify({ path, content: '' }) });
  if (res.ok) {
    creating.value = false;
    editing.value = path;
  } else if (res.status === 409) {
    Toast.fail('笔记已存在');
  }
}

async function openMatch(match: VaultSearchMatch): Promise<void> {
  editing.value = match.path;
}

onMounted(() => void openRoot());
</script>

<template>
  <div class="page">
    <NavBar :title="title" left-arrow @click-left="back" />
    <Search v-model="query" placeholder="搜索笔记" @update:model-value="runSearch" />
    <div v-if="creating" class="create-row">
      <Field v-model="newNotePath" placeholder="路径，如 工作日报/2026-09/新笔记.md" />
      <Button size="small" type="primary" @click="createNote">创建</Button>
    </div>
    <NoteEditor v-if="editing !== null" :path="editing" @close="editing = null" />
    <CellGroup v-else-if="matches !== null">
      <Cell v-for="match in matches" :key="match.path + match.line" :title="match.path" :label="`${match.line}: ${match.text}`" is-link @click="openMatch(match)" />
      <Cell v-if="matches.length === 0" title="（无结果）" />
    </CellGroup>
    <CellGroup v-else>
      <Cell v-for="node in current()" :key="node.path" :title="node.name" :is-link="node.kind === 'dir'" @click="enter(node)">
        <template #value>
          <span v-if="node.kind === 'file'">{{ Math.ceil((node.sizeBytes ?? 0) / 1024) }}KB</span>
        </template>
      </Cell>
    </CellGroup>
    <Button block plain type="primary" class="new-note" @click="creating = true">新建笔记</Button>
  </div>
</template>

<style scoped>
.create-row { display: flex; gap: 8px; padding: 8px; align-items: center; }
.new-note { margin: 8px; width: calc(100% - 16px); }
</style>
```

`packages/pwa/src/components/NoteEditor.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, Field, Toast } from 'vant';
import { apiFetch } from '../lib/api';

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const content = ref('');
const saving = ref(false);

onMounted(async () => {
  const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(props.path)}`);
  if (res.ok) content.value = (await res.json())['content'] as string;
  else Toast.fail('读取失败');
});

async function save(): Promise<void> {
  saving.value = true;
  try {
    const res = await apiFetch('/api/vault/file', {
      method: 'PUT',
      body: JSON.stringify({ path: props.path, content: content.value }),
    });
    if (res.ok) Toast.success('已保存（obsidian-git 兜底留痕）');
    else Toast.fail('保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="editor">
    <div class="path">{{ path }}</div>
    <Field v-model="content" type="textarea" rows="16" autosize maxlength="-1" />
    <div class="row">
      <Button plain @click="emit('close')">关闭</Button>
      <Button type="primary" :loading="saving" @click="save">保存</Button>
    </div>
  </div>
</template>

<style scoped>
.editor { padding: 8px; }
.path { font-size: 12px; color: #969799; padding: 4px 0; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
</style>
```

`packages/pwa/src/pages/Settings.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, Cell, CellGroup, Field } from 'vant';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const tokenInput = ref(auth.token);
const vaultStatus = ref('检测中…');

async function probeVault(): Promise<void> {
  try {
    const res = await apiFetch('/api/vault/tree');
    vaultStatus.value = res.ok ? '已连接' : '未配置（503）';
  } catch {
    vaultStatus.value = 'daemon 不可达';
  }
}

function saveToken(): void {
  auth.setToken(tokenInput.value.trim());
  window.location.reload();
}

onMounted(() => void probeVault());
</script>

<template>
  <div class="page">
    <CellGroup title="认证">
      <Field v-model="tokenInput" placeholder="访问令牌 (CCFERRY_TOKEN)" clearable />
      <Cell title="">
        <template #value>
          <Button size="small" type="primary" @click="saveToken">保存并重载</Button>
        </template>
      </Cell>
    </CellGroup>
    <CellGroup title="状态">
      <Cell title="daemon 地址" :value="auth.daemonBase" />
      <Cell title="知识库" :value="vaultStatus" />
    </CellGroup>
  </div>
</template>
```

- [ ] **Step 2: Run tests + typecheck + build**

```bash
pnpm --filter @ccferry/pwa exec vitest run src/
pnpm -r typecheck
pnpm --filter @ccferry/pwa build
```

Expected: tests PASS, typecheck clean, build produces `packages/pwa/dist` with `index.html` + service worker.

- [ ] **Step 3: Commit**

```bash
git add packages/pwa
git commit -m "feat(pwa): add vault browser, note editor and settings" -m "- drill-down folder list with debounced full-text search
- markdown note editor with PUT save and create flow
- settings page with token entry and vault status probe"
```

---

### Task 13: M2 acceptance — LAN end-to-end + findings

**Files:**
- Create: `docs/notes/m2-findings.md`
- No production code expected; fix-forward if the smoke reveals defects.

**Interfaces:**
- Consumes: the built PWA + running daemon
- Produces: recorded evidence that M2 acceptance passes (看流 / 续聊 / 批权限 / 管知识库 on LAN)

- [ ] **Step 1: Build and start**

```bash
pnpm --filter @ccferry/pwa build
CCFERRY_TOKEN=devtoken CCFERRY_HOST=0.0.0.0 pnpm --filter @ccferry/client start
```

Expected log: `ccferry daemon listening on http://0.0.0.0:8787` and NO "PWA directory not found" warning.

- [ ] **Step 2: PC-side API verification with token**

```bash
curl -s -H "Authorization: Bearer devtoken" http://127.0.0.1:8787/api/projects | head -c 300
curl -s -H "Authorization: Bearer devtoken" "http://127.0.0.1:8787/api/vault/tree" | head -c 300
curl -s "http://127.0.0.1:8787/api/projects"            # expect 401
curl -s "http://127.0.0.1:8787/api/vault/file?path=../x.md" -H "Authorization: Bearer devtoken"   # expect 400 path_escape
curl -sN "http://127.0.0.1:8787/api/approvals/stream?token=devtoken" --max-time 2   # SSE headers, empty pending
```

Expected: each line's comment. Record outputs.

- [ ] **Step 3: Approval round-trip (PC-side simulation)**

Open a second terminal and create a pending approval via a scripted SDK query that requests a non-whitelisted tool (a one-off tsx snippet with `query({ prompt: 'run `git status` via the Bash tool' })` against the SdkDriver-less path is NOT possible from outside — instead use the PWA test below on the phone; on PC verify the timeout path):

```bash
# with the daemon stopped, run a tiny node script against ApprovalBroker directly:
pnpm --filter @ccferry/client exec tsx -e "import { ApprovalBroker } from './src/approval/broker'; const b = new ApprovalBroker({ timeoutMs: 2000 }); b.requestApproval({ sessionId: null, toolName: 'Bash', input: {} }).then((r) => console.log('outcome:', JSON.stringify(r)));"
```

Expected: after ~2s: `outcome: {"behavior":"deny","message":"approval timeout (2s) — denied by default"}`.

- [ ] **Step 4: Phone acceptance (human checklist — do these on the phone on the same Wi-Fi)**

1. Open `http://<PC-LAN-IP>:8787/` → PWA loads → 设置 → enter token → 保存并重载
2. 总览 shows real projects/sessions with status badges
3. Open the newest idle session → bubbles stream; send a reply (续聊) and watch the assistant answer
4. In a session, trigger a tool that needs approval (ask it to run a command) → 批准卡 appears with countdown → tap 允许 → tool proceeds; tap 拒绝 on another → tool denied
5. Let one approval hit 60s → auto-denied
6. 知识库 → browse tree → open a note → edit → 保存 → verify on PC the file changed
7. 搜索 a known phrase → matches with line numbers
8. agent 整理 → new vault session appears and streams
9. (PWA) Add to home screen → launches standalone

Record results per item in `docs/notes/m2-findings.md`.

- [ ] **Step 5: Write findings and close M2**

`docs/notes/m2-findings.md`:

```markdown
# M2 Findings

Evidence log for the M2 plan. Acceptance = spec section 5 (LAN 全流程).

## PC-side API smoke

- (paste Step 2 outputs per route)

## Approval fail-closed

- (paste Step 3 timeout outcome)

## Phone acceptance checklist

- [ ] PWA loads + token entry
- [ ] overview with badges
- [ ] live stream + 续聊
- [ ] approval allow / deny / 60s auto-deny
- [ ] vault browse / edit / search / agent 整理
- [ ] add to home screen

## Notes / defects found

- (any fix-forward commits listed here)
```

Also update the vault task page `工作任务/待办/2026-09-25-ClaudeCode远程交互系统.md` (in the vault repo — obsidian-git auto-commits): set the M2 milestone row to ✅ with date, bump `progress` frontmatter to ~65.

- [ ] **Step 6: Final green run and commit**

```bash
pnpm -r test
pnpm -r typecheck
git add docs/notes/m2-findings.md
git commit -m "docs: record M2 acceptance evidence" -m "- verify LAN full flow: stream, resume, approvals, vault
- close milestone M2"
```

---

## Self-Review (completed by plan author)

- Spec coverage: D1 (Task 9), D2 (Task 7), D3 (Task 10-12), D4 (Tasks 3-4), D5 (Tasks 3, 5), D6 (Tasks 9-10); protocol (Task 1); config (Task 2); vault service (Tasks 6-8); PWA pages (Tasks 10-12); acceptance (Task 13). 总览状态徽标 + vault 会话创建 + agent 整理 all land. No gaps found.
- Review Focus: all five pinned (T6 escape matrix, T3 timeout/double-decide, T9 bind refusal, T5 reconnect snapshot, T3 truncation) plus blank-search and non-md.
- Type consistency: `ScanFn`/`cachedScan` (T4) consumed by `SdkDriverOptions.scan`; `startSse` moved to `sse.ts` (T5) and imported by approval/new-session routes (T5/T8); `ServerOptions` grows `broker` (T5) → `vaultRoot` (T8) → `token` (T9) with `main.ts` updated at each step; PWA `apiFetch`/`sseUrl`/`readSsePost` signatures identical across Tasks 10-12.




