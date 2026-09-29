import { describe, expect, it } from 'vitest';
import type { ParsedLine } from '@ccferry/protocol';
import { extractToolResult, parsedLineToBubbles } from './bubbles';

describe('parsedLineToBubbles', () => {
  it('maps user/assistant text lines to text bubbles', () => {
    const user = parsedLineToBubbles({ ok: true, line: 1, json: { type: 'user', message: { content: 'hi' } } });
    expect(user).toEqual([{ kind: 'text', role: 'user', text: 'hi' }]);
    const assistant = parsedLineToBubbles({
      ok: true,
      line: 2,
      json: { type: 'assistant', message: { content: [{ type: 'text', text: 'bo' }] } },
    });
    expect(assistant).toEqual([{ kind: 'text', role: 'assistant', text: 'bo' }]);
  });

  it('maps every block: text plus ALL tool calls of one line', () => {
    const bubbles = parsedLineToBubbles({
      ok: true,
      line: 3,
      json: {
        type: 'assistant',
        timestamp: '2026-09-27T14:05:00.000Z',
        message: {
          content: [
            { type: 'text', text: 'let me fix that' },
            { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'D:\\work\\pkg\\src\\a.md' } },
            { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'systemctl restart taos\nls -la' } },
          ],
        },
      },
    });
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toMatchObject({ kind: 'text', text: 'let me fix that' });
    expect(bubbles[1]).toMatchObject({ kind: 'tool', name: 'Edit', summary: 'a.md', toolUseId: 't1' });
    expect(bubbles[2]).toMatchObject({ kind: 'tool', name: 'Bash', summary: 'systemctl restart taos ls -la', toolUseId: 't2' });
    expect(bubbles[1] && 'ts' in bubbles[1] && bubbles[1].ts).toMatch(/^(?:\d{2}-\d{2} )?\d{2}:\d{2}$/);
  });

  it('summarizes grep/glob by pattern and unknown tools by json', () => {
    const [grep] = parsedLineToBubbles({
      ok: true, line: 4, json: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'sn_prod', path: 'x' } }] } },
    });
    expect(grep).toMatchObject({ summary: 'sn_prod' });
    const [weird] = parsedLineToBubbles({
      ok: true, line: 5, json: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Foo', input: { a: 1 } }] } },
    });
    expect(weird).toMatchObject({ summary: '{"a":1}' });
  });

  it('maps failed lines to raw bubbles and skips noise', () => {
    expect(parsedLineToBubbles({ ok: false, line: 4, raw: 'garbage{' })).toEqual([{ kind: 'raw', text: 'garbage{' }]);
    expect(parsedLineToBubbles({ ok: false, line: 5, raw: '' })).toEqual([]);
    expect(parsedLineToBubbles({ ok: true, line: 6, json: { type: 'system', subtype: 'init' } })).toEqual([]);
  });
});

describe('extractToolResult', () => {
  const resultLine: ParsedLine = {
    ok: true,
    line: 7,
    json: {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: 'The file has been updated.' }],
          },
        ],
      },
    },
  };

  it('pairs a tool_result to its tool_use_id and extracts text', () => {
    expect(extractToolResult(resultLine)).toEqual({ id: 't1', text: 'The file has been updated.', isError: false });
  });

  it('handles string content and error results', () => {
    const line: ParsedLine = {
      ok: true,
      line: 8,
      json: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }] } },
    };
    expect(extractToolResult(line)).toEqual({ id: 't2', text: 'boom', isError: true });
  });

  it('returns null for lines without tool results', () => {
    expect(extractToolResult({ ok: true, line: 9, json: { type: 'user', message: { content: 'plain text' } } })).toBeNull();
    expect(extractToolResult({ ok: false, line: 10, raw: 'x' })).toBeNull();
  });
});
