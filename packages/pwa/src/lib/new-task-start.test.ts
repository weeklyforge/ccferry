import { describe, expect, it } from 'vitest';
import { awaitStart } from './new-task-start';

function sse(events: string[], failAfterFirst: Error | null = null): {
  run: (onEvent: (data: string) => void) => Promise<void>;
} {
  return {
    run: (onEvent: (data: string) => void) =>
      (async () => {
        if (events.length === 0) throw failAfterFirst ?? new Error('no events');
        for (const data of events) {
          if (data === '__fail__') throw failAfterFirst ?? new Error('stream failed');
          await new Promise((r) => setTimeout(r, 1));
          onEvent(data);
        }
      })(),
  };
}

describe('awaitStart', () => {
  it('resolves on the first streamed event while the stream continues', async () => {
    let firstSeen = false;
    const stream = sse(['{"type":"system","subtype":"init"}', '{"type":"result"}']);
    const done = awaitStart(stream.run, () => {
      firstSeen = true;
    });
    await done;
    expect(firstSeen).toBe(true);
  });

  it('rejects when the request fails before any event', async () => {
    const stream = sse([], new Error('HTTP 403'));
    await expect(awaitStart(stream.run, () => undefined)).rejects.toThrow('HTTP 403');
  });

  it('ignores post-start stream failures — the task continues on the PC', async () => {
    const stream = sse(['{"type":"system"}', '__fail__'], new Error('network drop'));
    await expect(awaitStart(stream.run, () => undefined)).resolves.toBeUndefined();
  });
});
