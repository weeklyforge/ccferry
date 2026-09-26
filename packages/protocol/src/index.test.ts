import { describe, expect, it } from 'vitest';
import type { ParsedLine } from './index';

describe('protocol types', () => {
  it('accepts a well-formed ParsedLine', () => {
    const line: ParsedLine = { ok: true, line: 1, json: { type: 'user' } };
    expect(line.ok).toBe(true);
  });
});
