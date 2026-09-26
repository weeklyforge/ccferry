import { describe, expect, it } from 'vitest';
import { extractFirstUserText, parseLine } from './parse';

describe('parseLine', () => {
  it('parses a valid JSON line', () => {
    const line = parseLine('{"type":"user"}', 1);
    expect(line).toEqual({ ok: true, line: 1, json: { type: 'user' } });
  });

  it('returns ok:false with the raw text for a half-written line (Review Focus 1)', () => {
    const line = parseLine('{"type":"user",', 2);
    expect(line).toEqual({ ok: false, line: 2, raw: '{"type":"user",' });
  });

  it('returns ok:false for blank and non-object lines', () => {
    expect(parseLine('', 3)).toEqual({ ok: false, line: 3, raw: '' });
    expect(parseLine('42', 4).ok).toBe(false);
    expect(parseLine('null', 5).ok).toBe(false);
  });
});

describe('extractFirstUserText', () => {
  it('reads string content', () => {
    const json = { type: 'user', message: { content: 'hello world' } };
    expect(extractFirstUserText(json)).toBe('hello world');
  });

  it('reads text blocks from array content', () => {
    const json = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'block text' }] },
    };
    expect(extractFirstUserText(json)).toBe('block text');
  });

  it('returns null for non-user lines', () => {
    expect(extractFirstUserText({ type: 'assistant' })).toBeNull();
  });
});
