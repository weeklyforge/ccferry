import { describe, expect, it } from 'vitest';
import type { ApprovalBroker } from './broker';
import { DEFAULT_TOOL_WHITELIST, createCanUseTool, evaluateToolPolicy } from './policy';

describe('createCanUseTool (composition pin)', () => {
  it('allows whitelisted tools without touching the broker', async () => {
    const broker = { requestApproval: () => { throw new Error('must not be called'); } } as unknown as ApprovalBroker;
    const canUseTool = createCanUseTool(DEFAULT_TOOL_WHITELIST, broker);
    expect(await canUseTool('Read', { file_path: 'a' })).toEqual({ behavior: 'allow' });
  });

  it('routes non-whitelisted tools through the broker with session attribution', async () => {
    const seen: Array<{ sessionId: string | null; toolName: string; input: Record<string, unknown> }> = [];
    const broker = {
      requestApproval(input: { sessionId: string | null; toolName: string; input: Record<string, unknown> }) {
        seen.push(input);
        return Promise.resolve({ behavior: 'deny' as const, message: 'no' });
      },
    } as unknown as ApprovalBroker;
    const canUseTool = createCanUseTool(DEFAULT_TOOL_WHITELIST, broker, () => 'session-9');
    expect(await canUseTool('Bash', { command: 'ls' })).toEqual({ behavior: 'deny', message: 'no' });
    expect(seen).toEqual([{ sessionId: 'session-9', toolName: 'Bash', input: { command: 'ls' } }]);
  });

  it('stays fail-closed when no broker is configured', async () => {
    const canUseTool = createCanUseTool(DEFAULT_TOOL_WHITELIST);
    const outcome = await canUseTool('Write', { file_path: 'a' });
    expect(outcome.behavior).toBe('deny');
  });
});

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
