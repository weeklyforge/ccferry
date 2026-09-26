// Cloud-side backpressure for tunneled response bodies: write DATA frames to
// the phone response in frame order, but when the socket reports a full
// buffer (write() === false), wait for drain instead of queueing unboundedly.
// flush() lets a completing path (CLOSE) wait for queued writes before end().
export interface DrainableRaw {
  write(chunk: Buffer): boolean;
  once(event: 'drain', listener: () => void): unknown;
  destroyed: boolean;
}

export interface OrderedWriter {
  write(chunk: Buffer): void;
  flush(): Promise<void>;
}

export function createOrderedWriter(raw: DrainableRaw): OrderedWriter {
  let chain: Promise<void> = Promise.resolve();
  return {
    write(chunk: Buffer): void {
      chain = chain.then(async () => {
        if (raw.destroyed) return;
        if (!raw.write(chunk)) {
          await new Promise<void>((resolve) => raw.once('drain', resolve));
        }
      });
    },
    flush(): Promise<void> {
      return chain;
    },
  };
}
