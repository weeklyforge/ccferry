// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clientId } from './client-id';

describe('clientId', () => {
  it('returns a stable id across calls', () => {
    const a = clientId();
    expect(a).toBe(clientId());
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});
