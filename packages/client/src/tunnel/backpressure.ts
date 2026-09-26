// Spec section 1 backpressure v0: when the outbound ws buffer is backed up
// past the high-water mark, hold off sending further frames until it drains.
// Without this, a localhost-speed upstream streaming a full 20MB session
// history through a 3-5Mbps server link buffers the whole response in memory.
export const BACKPRESSURE_LIMIT_BYTES = 16 * 1024 * 1024;

export async function waitForBufferDrain(
  socket: { bufferedAmount: number },
  limitBytes = BACKPRESSURE_LIMIT_BYTES,
  pollMs = 25,
): Promise<void> {
  while (socket.bufferedAmount > limitBytes) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
