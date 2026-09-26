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
