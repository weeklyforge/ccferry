import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tailLines } from './tailer';

let tmp: string;
let filePath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-tail-'));
  filePath = path.join(tmp, 'session.jsonl');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function collectFirst(filePathToTail: string, count: number, fromStart: boolean): Promise<string[]> {
  const controller = new AbortController();
  const lines: string[] = [];
  for await (const line of tailLines(filePathToTail, { pollMs: 10, fromStart, signal: controller.signal })) {
    lines.push(line);
    if (lines.length >= count) {
      controller.abort();
      break;
    }
  }
  return lines;
}

describe('tailLines', () => {
  it('emits existing lines then follows appends', async () => {
    await fs.writeFile(filePath, 'line-1\nline-2\n');
    const pending = collectFirst(filePath, 3, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.appendFile(filePath, 'line-3\n');
    expect(await pending).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('does not emit an unterminated last line (Review Focus 5)', async () => {
    await fs.writeFile(filePath, 'line-1\nline-2'); // no trailing newline
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of tailLines(filePath, { pollMs: 10, fromStart: true, signal: controller.signal })) {
      lines.push(line);
      if (lines.length >= 1) {
        controller.abort();
        break;
      }
    }
    expect(lines).toEqual(['line-1']);
  });

  it('strips CRLF (Review Focus 5)', async () => {
    await fs.writeFile(filePath, 'win-line\r\n');
    expect(await collectFirst(filePath, 1, true)).toEqual(['win-line']);
  });

  it('resets on truncation and keeps following (Review Focus 4)', async () => {
    await fs.writeFile(filePath, 'long first content that will be truncated away\n');
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of tailLines(filePath, { pollMs: 10, fromStart: true, signal: controller.signal })) {
      lines.push(line);
      if (lines.length === 1) {
        await fs.writeFile(filePath, 'new-epoch\n'); // truncate + replace
      }
      if (lines.length >= 2) {
        controller.abort();
        break;
      }
    }
    expect(lines).toEqual(['long first content that will be truncated away', 'new-epoch']);
  });

  it('drops a pending partial line when the file is truncated (Review Focus 4)', async () => {
    await fs.writeFile(filePath, 'line-1\n{"type":"user","partial":'); // last line unterminated
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of tailLines(filePath, { pollMs: 10, fromStart: true, signal: controller.signal })) {
      lines.push(line);
      if (lines.length === 1) {
        await fs.writeFile(filePath, 'new-epoch\n'); // truncate + replace while carry holds the partial
      }
      if (lines.length >= 2) {
        controller.abort();
        break;
      }
    }
    expect(lines).toEqual(['line-1', 'new-epoch']);
  });
});
