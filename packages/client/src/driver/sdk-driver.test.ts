import { describe, expect, it, vi } from 'vitest';

// Captures the options the driver hands to the SDK query layer; hoisted so
// the module mock below can close over it.
const queryCalls: {
  prompt?: unknown;
  options?: { pathToClaudeCodeExecutable?: string; permissionMode?: string };
}[] = vi.hoisted(() => []);
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: async function* (q: {
    options?: { pathToClaudeCodeExecutable?: string; permissionMode?: string };
  }) {
    queryCalls.push(q);
    // Streaming input mode behaves like a live CLI: messages flow, and after
    // the result message the process stays alive waiting for more input. A
    // driver that never breaks out of the message loop hangs here forever.
    yield { type: 'system', subtype: 'init' };
    yield { type: 'result', subtype: 'success', result: 'done', session_id: 'sid-1' };
    await new Promise(() => undefined);
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

  it('sends the prompt as a streaming input stream, not a bare string', async () => {
    const driver = new SdkDriver('/nonexistent', {
      execPath: 'C:\\node\\node.exe',
      exists: () => false,
    });
    for await (const _ of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'hi' })) {
      void _;
    }
    const prompt = queryCalls.at(-1)?.prompt;
    expect(prompt).not.toBeNull();
    expect(typeof prompt).toBe('object');
    const stream = prompt as AsyncIterable<unknown>;
    expect(typeof (stream as unknown as { next: unknown }).next).toBe('function');
    // the first streamed message carries the prompt text
    for await (const msg of stream) {
      expect(JSON.stringify(msg)).toContain('hi');
      break; // the stream never completes by design — pull one message
    }
  });

  it('returns after the result message even though the CLI stream stays open', async () => {
    const driver = new SdkDriver('/nonexistent', {
      execPath: 'C:\\node\\node.exe',
      exists: () => false,
    });
    const events = [];
    for await (const event of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'hi' })) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({ type: 'result', subtype: 'success', text: 'done', sessionId: 'sid-1' });
  });

  it('requests auto permission mode only when the send asks for it', async () => {
    const driver = new SdkDriver('/nonexistent', {
      execPath: 'C:\\node\\node.exe',
      exists: () => false,
    });
    for await (const _ of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'a' })) {
      void _;
    }
    expect(queryCalls.at(-1)?.options?.permissionMode).toBeUndefined();

    for await (const _ of driver.sendMessage({ sessionId: null, projectPath: 'C:\\p', text: 'b', mode: 'auto' })) {
      void _;
    }
    expect(queryCalls.at(-1)?.options?.permissionMode).toBe('auto');
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
