import { describe, expect, it } from 'vitest';
import type { ParsedLine } from '@ccferry/protocol';
import { LineDedupe } from './line-dedupe';

const line = (uuid: string): ParsedLine => ({ ok: true, line: 1, json: { uuid, type: 'user' } });

describe('LineDedupe', () => {
  it('accepts a line once and skips its replay', () => {
    const d = new LineDedupe();
    expect(d.firstOf(line('a'))).toBe(true);
    expect(d.firstOf(line('a'))).toBe(false); // replayed after reconnect
    expect(d.firstOf(line('b'))).toBe(true);
  });

  it('falls back to content hash when the line has no uuid', () => {
    const d = new LineDedupe();
    const noId: ParsedLine = { ok: true, line: 9, json: { type: 'user', message: 'same' } };
    expect(d.firstOf(noId)).toBe(true);
    expect(d.firstOf(noId)).toBe(false);
  });

  it('forgets oldest lines beyond the capacity window', () => {
    const d = new LineDedupe(6);
    for (let i = 0; i < 10; i++) d.firstOf(line('k' + i));
    expect(d.firstOf(line('k0'))).toBe(true); // evicted — accepted again
  });

  it('reset clears everything (explicit full-history reload)', () => {
    const d = new LineDedupe();
    d.firstOf(line('a'));
    d.reset();
    expect(d.firstOf(line('a'))).toBe(true);
  });
});
