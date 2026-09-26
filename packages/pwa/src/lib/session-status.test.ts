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
