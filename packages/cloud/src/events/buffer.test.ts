import { describe, expect, it } from 'vitest';
import { EventBuffer } from './buffer';

describe('EventBuffer', () => {
  it('keeps the newest 64 events', () => {
    const buffer = new EventBuffer();
    for (let i = 0; i < 70; i++) buffer.push({ i });
    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(64);
    expect(snapshot[0]).toEqual({ i: 6 });
    expect(snapshot[63]).toEqual({ i: 69 });
  });

  it('delivers pushes to subscribers', () => {
    const buffer = new EventBuffer();
    const seen: number[] = [];
    const unsubscribe = buffer.subscribe((event) => seen.push(event['i'] as number));
    buffer.push({ i: 1 });
    buffer.push({ i: 2 });
    unsubscribe();
    buffer.push({ i: 3 });
    expect(seen).toEqual([1, 2]);
  });
});
