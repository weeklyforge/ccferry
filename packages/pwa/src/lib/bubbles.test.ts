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

  it('carries a local HH:mm time from the line timestamp', () => {
    const bubble = parsedLineToBubble({
      ok: true,
      line: 1,
      json: { type: 'user', timestamp: '2026-09-27T14:05:00.000Z', message: { content: 'hi' } },
    });
    // Local timezone dependent — assert shape, not the exact clock.
    expect(bubble).toMatchObject({ kind: 'text', role: 'user', text: 'hi' });
    expect(bubble && 'ts' in bubble && bubble.ts).toMatch(/^\d{2}:\d{2}$/);
    const noTs = parsedLineToBubble({ ok: true, line: 2, json: { type: 'user', message: { content: 'x' } } });
    expect(noTs && 'ts' in noTs && noTs.ts).toBeUndefined();
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
