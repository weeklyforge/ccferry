import { describe, expect, it } from 'vitest';
import { createOrderedWriter } from './ordered-writer';

class FakeRaw {
  written: Buffer[] = [];
  destroyed = false;
  private blocked = false;
  private drainListeners: (() => void)[] = [];

  write(chunk: Buffer): boolean {
    this.written.push(chunk);
    return !this.blocked;
  }

  once(_event: 'drain', listener: () => void): void {
    this.drainListeners.push(listener);
  }

  blockNext(): void {
    this.blocked = true;
  }

  emitDrain(): void {
    this.blocked = false;
    const listeners = this.drainListeners.splice(0);
    for (const listener of listeners) listener();
  }

  text(): string {
    return this.written.map((b) => b.toString()).join('');
  }
}

describe('createOrderedWriter (cloud-side backpressure)', () => {
  it('keeps frame order while waiting for drain', async () => {
    const raw = new FakeRaw();
    const writer = createOrderedWriter(raw);
    raw.blockNext(); // first write reports a full buffer
    writer.write(Buffer.from('a'));
    writer.write(Buffer.from('b')); // must not land before drain
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(raw.text()).toBe('a');
    raw.emitDrain();
    await writer.flush();
    expect(raw.text()).toBe('ab');
  });

  it('skips writes issued after destroy', async () => {
    const raw = new FakeRaw();
    const writer = createOrderedWriter(raw);
    writer.write(Buffer.from('a'));
    await writer.flush(); // 'a' lands before the destroy
    raw.destroyed = true;
    writer.write(Buffer.from('b'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(raw.text()).toBe('a');
  });

  it('flush() resolves only after queued writes have landed', async () => {
    const raw = new FakeRaw();
    const writer = createOrderedWriter(raw);
    raw.blockNext();
    writer.write(Buffer.from('a'));
    let flushed = false;
    void writer.flush().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(flushed).toBe(false); // still waiting on drain
    raw.emitDrain();
    await writer.flush();
    expect(flushed).toBe(true);
    expect(raw.text()).toBe('a');
  });
});
