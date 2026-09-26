import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHead, scanStore } from './scanner';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-scan-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSession(dirName: string, fileName: string, lines: string[]): Promise<string> {
  const dir = path.join(tmp, 'projects', dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, lines.join('\n') + '\n');
  return filePath;
}

describe('scanStore', () => {
  it('lists sessions with metadata from the store layout', async () => {
    await writeSession('D--work-proj-A', '11111111-aaaa-4bbb-8ccc-000000000001.jsonl', [
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj A', message: { content: 'fix the login bug' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
    ]);
    await writeSession('D--work-proj-A', '11111111-aaaa-4bbb-8ccc-000000000002.jsonl', [
      'not json at all',
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj A', message: { content: 'second session' } }),
    ]);
    await writeSession('D--work-proj-B', '11111111-aaaa-4bbb-8ccc-000000000003.jsonl', [
      JSON.stringify({ type: 'user', cwd: 'D:\\work\\proj B', message: { content: 'proj b task' } }),
    ]);
    await fs.mkdir(path.join(tmp, 'projects', 'D--empty-proj'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'projects', 'D--work-proj-A', 'notes.txt'), 'ignore me');

    const { projects, sessions } = await scanStore(tmp);

    expect(sessions).toHaveLength(3);
    expect(projects).toHaveLength(2);
    const a = sessions.find((s) => s.sessionId.startsWith('11111111-aaaa-4bbb-8ccc-000000000001'));
    expect(a?.projectPath).toBe('D:\\work\\proj A');
    expect(a?.firstUserText).toBe('fix the login bug');
    expect(a?.file).toContain('11111111-aaaa-4bbb-8ccc-000000000001.jsonl');
    // Review Focus 1: the garbage line is skipped, summary still built from the next line
    const b = sessions.find((s) => s.sessionId.startsWith('11111111-aaaa-4bbb-8ccc-000000000002'));
    expect(b?.firstUserText).toBe('second session');
    // sorted newest first
    expect(sessions[0]!.lastModifiedMs).toBeGreaterThanOrEqual(sessions[1]!.lastModifiedMs);
  });

  it('falls back to decoded munged dir name when cwd is absent', async () => {
    await writeSession('D--work-fallback', '11111111-aaaa-4bbb-8ccc-000000000004.jsonl', [
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
    ]);
    const { sessions } = await scanStore(tmp);
    expect(sessions[0]?.projectPath).toBe('D:\\work\\fallback');
  });
});

describe('readHead', () => {
  it('caps the read at capBytes (Review Focus 2)', async () => {
    const filePath = path.join(tmp, 'big.jsonl');
    await fs.writeFile(filePath, 'x'.repeat(10_000));
    const head = await readHead(filePath, 16);
    expect(head.length).toBeLessThanOrEqual(16);
  });
});
