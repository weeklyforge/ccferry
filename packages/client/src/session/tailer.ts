import { createReadStream, promises as fs } from 'node:fs';

export interface TailOptions {
  pollMs?: number;
  signal?: AbortSignal;
  fromStart?: boolean;
}

const NEWLINE = 0x0a;

export async function* tailLines(filePath: string, opts: TailOptions = {}): AsyncGenerator<string> {
  const pollMs = opts.pollMs ?? 1000;
  let offset = opts.fromStart ? 0 : (await fs.stat(filePath)).size;
  let carry: Buffer = Buffer.alloc(0);
  while (!opts.signal?.aborted) {
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      await sleep(pollMs); // file temporarily gone (rotation); wait for it
      continue;
    }
    if (size < offset) offset = 0; // truncated or rotated: re-read from the start
    if (size > offset) {
      const stream = createReadStream(filePath, { start: offset });
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        carry = carry.length === 0 ? buf : Buffer.concat([carry, buf]);
        let idx = carry.indexOf(NEWLINE);
        while (idx >= 0) {
          yield carry.subarray(0, idx).toString('utf8').replace(/\r$/, '');
          carry = carry.subarray(idx + 1);
          idx = carry.indexOf(NEWLINE);
        }
        offset += buf.length;
      }
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
