import { describe, expect, it } from 'vitest';
import { waitForBufferDrain } from './backpressure';

const LIMIT = 16 * 1024 * 1024;

describe('waitForBufferDrain (spec section 1 backpressure v0)', () => {
  it('waits until the buffer drains below the limit', async () => {
    const socket = { bufferedAmount: LIMIT + 4 * 1024 * 1024 };
    setTimeout(() => {
      socket.bufferedAmount = 1024;
    }, 60);
    const started = Date.now();
    await waitForBufferDrain(socket, LIMIT, 10);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40); // actually waited
    expect(socket.bufferedAmount).toBeLessThanOrEqual(LIMIT);
  });

  it('returns immediately when under the limit', async () => {
    const socket = { bufferedAmount: 1024 };
    const started = Date.now();
    await waitForBufferDrain(socket, LIMIT, 10);
    expect(Date.now() - started).toBeLessThan(40);
  });
});
