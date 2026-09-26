import { createReadStream, promises as fs } from 'node:fs';

export interface TailOptions {
  pollMs?: number;
  signal?: AbortSignal;
  fromStart?: boolean;
  /** Explicit start offset (wins over fromStart); a partial first line is skipped. */
  fromByte?: number;
}

const NEWLINE = 0x0a;

export async function* tailLines(filePath: string, opts: TailOptions = {}): AsyncGenerator<string> {
  const pollMs = opts.pollMs ?? 1000;
  let offset = opts.fromStart ? 0 : (await fs.stat(filePath)).size;
  let skipPartialFirstLine = false;
  if (typeof opts.fromByte === 'number' && opts.fromByte > 0) {
    offset = opts.fromByte;
    skipPartialFirstLine = true; // mid-line start: drop bytes before the first newline
  }
  let carry: Buffer = Buffer.alloc(0);
  while (!opts.signal?.aborted) {
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      await sleep(pollMs); // file temporarily gone (rotation); wait for it
      continue;
    }
    if (size < offset) {
      offset = 0; // truncated or rotated: re-read from the start
      carry = Buffer.alloc(0); // a pending partial line belongs to the old epoch
    }
    if (size > offset) {
      const stream = createReadStream(filePath, { start: offset });
      for await (const chunk of stream) {
        let buf = chunk as Buffer;
        if (skipPartialFirstLine) {
          const firstNewline = buf.indexOf(NEWLINE);
          if (firstNewline < 0) {
            offset += buf.length; // still inside the partial line — skip it all
            continue;
          }
          buf = buf.subarray(firstNewline + 1);
          skipPartialFirstLine = false;
        }
        carry = carry.length === 0 ? buf : Buffer.concat([carry, buf]);
        let idx = carry.indexOf(NEWLINE);
        while (idx >= 0) {
          yield carry.subarray(0, idx).toString('utf8').replace(/\r$/, '');
          carry = carry.subarray(idx + 1);
          idx = carry.indexOf(NEWLINE);
        }
        offset += (chunk as Buffer).length;
      }
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
