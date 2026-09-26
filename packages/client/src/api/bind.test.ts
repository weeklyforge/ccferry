import { describe, expect, it } from 'vitest';
import { computeBindHost } from './bind';

describe('computeBindHost (Review Focus 3)', () => {
  it('refuses LAN bind without a token, whatever the env says', () => {
    expect(computeBindHost(undefined, '0.0.0.0')).toBe('127.0.0.1');
    expect(computeBindHost('', '0.0.0.0')).toBe('127.0.0.1');
  });

  it('honors CCFERRY_HOST only when a token is set', () => {
    expect(computeBindHost('secret', '0.0.0.0')).toBe('0.0.0.0');
    expect(computeBindHost('secret', undefined)).toBe('127.0.0.1');
  });
});
