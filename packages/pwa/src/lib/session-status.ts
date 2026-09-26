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
