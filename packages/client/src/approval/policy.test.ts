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
