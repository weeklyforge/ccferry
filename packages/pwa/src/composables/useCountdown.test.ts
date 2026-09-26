import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  it('ticks down toward the deadline and clamps at zero', () => {
    const deadline = Date.now() + 5000;
    const { remaining } = useCountdown(deadline);
    expect(remaining.value).toBe(5000);
    vi.advanceTimersByTime(3000);
    expect(remaining.value).toBe(2000);
    vi.advanceTimersByTime(5000);
    expect(remaining.value).toBe(0);
  });
});
