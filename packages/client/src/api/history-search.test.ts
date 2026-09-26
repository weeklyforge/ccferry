import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionSummary } from '@ccferry/protocol';
import { searchSessions } from './history-search';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-history-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function summary(id: string, opts: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: id,
    projectPath: 'D:\\p',
    file: path.join(dir, `${id}.jsonl`),
    sizeBytes: 1,
    lastModifiedMs: Date.now(),
    firstUserText: 'greeting text',
    ...opts,
  };
}

describe('searchSessions', () => {
  it('matches content case-insensitively and reports line numbers', async () => {
    const file = summary('a').file;
    await fs.writeFile(file, '{"type":"user"}\nfind the Smart Heating note here\n');
    const size = (await fs.stat(file)).size;
    const { matches, truncated } = await searchSessions([summary('a', { sizeBytes: size })], 'smart heating', {});
    expect(truncated).toBe(false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ sessionId: 'a', line: 2 });
    expect(matches[0]!.text).toContain('Smart Heating');
  });

  it('matches titles via firstUserText without reading files', async () => {
    const { matches } = await searchSessions([summary('b', { file: path.join(dir, 'missing.jsonl') })], 'GREETING', {});
    expect(matches).toHaveLength(1);
    expect(matches[0]!.line).toBe(0); // title hit
  });

  it('filters by project and days', async () => {
    const old = summary('c', { projectPath: 'D:\\other', lastModifiedMs: Date.now() - 40 * 86_400_000 });
    old.sizeBytes = (await fs.writeFile(old.file, 'findme\n'), (await fs.stat(old.file)).size);
    const projOnly = await searchSessions([old], 'findme', { project: 'D:\\p' });
    expect(projOnly.matches).toHaveLength(0);
    const daysOnly = await searchSessions([old], 'findme', { days: 7 });
    expect(daysOnly.matches).toHaveLength(0);
  });

  it('stops at the byte cap and reports truncated', async () => {
    const ids = ['d1', 'd2', 'd3'];
    const sessions: SessionSummary[] = [];
    for (const [i, id] of ids.entries()) {
      const s = summary(id, { lastModifiedMs: Date.now() + (3 - i) * 1000 });
      await fs.writeFile(s.file, `findme ${id}\n`.repeat(50));
      s.sizeBytes = (await fs.stat(s.file)).size;
      sessions.push(s);
    }
    const { matches, truncated } = await searchSessions(sessions, 'findme', { byteCapBytes: 10 });
    expect(truncated).toBe(true);
    expect(matches.every((m) => m.sessionId === 'd1' || m.sessionId === 'd2')).toBe(true); // newest-first, d3 never scanned
  });
});
