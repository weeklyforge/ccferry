import { describe, expect, it } from 'vitest';
import { nextDelayMs } from './backoff';

describe('nextDelayMs', () => {
  it('grows exponentially and caps at 60s', () => {
    expect(nextDelayMs(0, () => 0.5)).toBe(1000);
    expect(nextDelayMs(3, () => 0.5)).toBe(8000);
    expect(nextDelayMs(10, () => 0.5)).toBe(60000);
    expect(nextDelayMs(50, () => 0.5)).toBe(60000);
  });

  it('applies +/-20% jitter bounded by the random input', () => {
    expect(nextDelayMs(0, () => 0)).toBe(800);       // 1000 * 0.8
    expect(nextDelayMs(0, () => 1)).toBe(1200);      // 1000 * 1.2
    expect(nextDelayMs(2, () => 0)).toBe(3200);      // 4000 * 0.8
  });

  it('never returns a non-positive delay', () => {
    expect(nextDelayMs(-5, () => 0)).toBe(800);
  });
});
