import { describe, expect, it, vi } from 'vitest';

// Captures the options the driver hands to the SDK query layer; hoisted so
// the module mock below can close over it.
const queryCalls: { options?: { pathToClaudeCodeExecutable?: string } }[] = vi.hoisted(() => []);
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: async function* (q: { options?: { pathToClaudeCodeExecutable?: string } }) {
    queryCalls.push(q);
  },
}));

import { mapSdkMessages, besideExecutableClaude, SdkDriver } from './sdk-driver';

describe('SdkDriver.sendMessage', () => {
  it('maps SDK messages into DriverEvents (assistant/system/result)', async () => {
    const events = [];
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

describe('besideExecutableClaude (compiled-exe single package)', () => {
  it('resolves the platform claude binary sitting next to the running exe', () => {
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const exe = `C:\\deploy\\ccferry-client.exe`;
    const beside = `C:\\deploy\\${name}`;
    expect(besideExecutableClaude(exe, (p: string) => p === beside)).toBe(beside);
  });

  it('returns undefined next to a plain node runtime (dev form)', () => {
    expect(besideExecutableClaude('C:\\node\\node.exe', () => false)).toBeUndefined();
  });

  it('passes the resolved path into query options', async () => {
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const driver = new SdkDriver('/nonexistent', {
      execPath: 'C:\\deploy\\ccferry-client.exe',
      exists: (p: string) => p.endsWith(name),
    });
    for await (const _ of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'hi' })) {
      void _;
    }
    expect(queryCalls.at(-1)?.options?.pathToClaudeCodeExecutable).toBe(`C:\\deploy\\${name}`);
  });

  it('omits the option when nothing sits beside the runtime', async () => {
    const driver = new SdkDriver('/nonexistent', {
      execPath: 'C:\\node\\node.exe',
      exists: () => false,
    });
    for await (const _ of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'hi' })) {
      void _;
    }
    expect(queryCalls.at(-1)?.options?.pathToClaudeCodeExecutable).toBeUndefined();
  });
});
