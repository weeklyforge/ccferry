import { describe, expect, it, vi } from 'vitest';
import { followSse } from './sse-follow';

class FakeSource {
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  close(): void {
    this.closed = true;
  }
  emitMessage(data: string): void {
    this.onmessage?.({ data });
  }
  emitError(): void {
    this.onerror?.({});
  }
}

function makeFactory() {
  const sources: FakeSource[] = [];
  const factory = vi.fn(() => {
    const source = new FakeSource();
    sources.push(source);
    return source;
  });
  return { sources, factory };
}

describe('followSse', () => {
  it('forwards messages from the stream', () => {
    const { sources, factory } = makeFactory();
    const onLine = vi.fn();
    followSse('http://x', { onLine, onReset: () => undefined, factory });
    expect(factory).toHaveBeenCalledTimes(1);
    sources[0]!.emitMessage('line-1');
    expect(onLine).toHaveBeenCalledWith('line-1');
  });

  it('closes, resets, and reconnects on error so replays cannot duplicate', () => {
    vi.useFakeTimers();
    try {
      const { sources, factory } = makeFactory();
      const onLine = vi.fn();
      const onReset = vi.fn();
      const handle = followSse('http://x', { onLine, onReset, factory, retryMs: 1000 });
      sources[0]!.emitMessage('old-line');
      sources[0]!.emitError();
      expect(sources[0]!.closed).toBe(true); // browser auto-reconnect disabled
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(1); // not yet — retryMs pending
      vi.advanceTimersByTime(1000);
      expect(factory).toHaveBeenCalledTimes(2);
      sources[1]!.emitMessage('replayed-line');
      expect(onLine).toHaveBeenCalledTimes(2); // old-line + replayed-line, no duplicates
      handle.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reconnecting after close()', () => {
    vi.useFakeTimers();
    try {
      const { sources, factory } = makeFactory();
      const handle = followSse('http://x', { onLine: () => undefined, onReset: () => undefined, factory, retryMs: 1000 });
      handle.close();
      expect(sources[0]!.closed).toBe(true);
      sources[0]!.emitError(); // error racing the close must not resurrect the stream
      vi.advanceTimersByTime(5000);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
