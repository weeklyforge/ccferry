import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalSettledFrame, ToolApprovalRequest } from '@ccferry/protocol';

export type ApprovalFrame = ToolApprovalRequest | ApprovalSettledFrame;

export type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string };

const STRING_VALUE_CAP = 1024;
const TOTAL_CAP = 16 * 1024;
// Long-lived daemons would otherwise accumulate settled ids forever;
// beyond the cap the whole set clears (ancient ids then report 404
// instead of 409 on a late second decision — still never double-applied).
const SETTLED_CAP = 1000;

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
  private readonly listeners = new Set<(frame: ApprovalFrame) => void>();

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
        }, 'timeout');
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
    return this.settle(approvalId, result, decision) ? 'applied' : 'unknown';
  }

  listPending(): ToolApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  subscribe(listener: (frame: ApprovalFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  settledCount(): number {
    return this.settled.size;
  }

  private settle(approvalId: string, result: PermissionResult, decision: ApprovalDecision | 'timeout'): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    this.settled.add(approvalId);
    if (this.settled.size > SETTLED_CAP) this.settled.clear();
    entry.resolve(result);
    const frame: ApprovalSettledFrame = { type: 'settled', approvalId, decision };
    for (const listener of this.listeners) listener(frame);
    return true;
  }
}
