import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import { startSse } from './sse';

interface FakeRaw {
  chunks: string[];
  writableEnded: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
}

function fakeRaw(): FakeRaw & ServerResponse {
  const raw = {
    chunks: [] as string[],
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      raw.chunks.push(chunk);
      return true;
    },
  };
  return raw as unknown as FakeRaw & ServerResponse;
}

describe('startSse heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes a comment keepalive every 15s of silence', () => {
    const raw = fakeRaw();
    startSse(raw);
    vi.advanceTimersByTime(15_000);
    expect(raw.chunks).toEqual([': ka\n\n']);
    vi.advanceTimersByTime(15_000);
    expect(raw.chunks).toEqual([': ka\n\n', ': ka\n\n']);
  });

  it('self-cleans once the response has ended and never writes after end', () => {
    const raw = fakeRaw();
    startSse(raw);
    vi.advanceTimersByTime(15_000);
    raw.writableEnded = true;
    vi.advanceTimersByTime(60_000);
    expect(raw.chunks).toEqual([': ka\n\n']);
  });
});
