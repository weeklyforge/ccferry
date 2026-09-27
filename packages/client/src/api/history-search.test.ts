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

  it('ANDs space-separated terms at the session level: terms may sit on different lines', async () => {
    const both = summary('both');
    await fs.writeFile(both.file, 'the smart part\nand the heating part elsewhere\n');
    both.sizeBytes = (await fs.stat(both.file)).size;
    const one = summary('one', { lastModifiedMs: Date.now() - 1000 });
    await fs.writeFile(one.file, 'only smart here\n');
    one.sizeBytes = (await fs.stat(one.file)).size;
    const { matches } = await searchSessions([both, one], 'smart heating', {});
    expect(matches.map((m) => m.sessionId)).toEqual(['both', 'both']); // one row per matching line
    expect(matches[0]).toMatchObject({ line: 1, text: 'the smart part' });
    expect(matches[1]).toMatchObject({ line: 2 });
  });

  it('returns at most three matching lines per session', async () => {
    const s = summary('cap');
    await fs.writeFile(s.file, 'hit one\nhit two\nhit three\nhit four\nhit five\n');
    s.sizeBytes = (await fs.stat(s.file)).size;
    const { matches } = await searchSessions([s], 'hit', {});
    expect(matches).toHaveLength(3);
  });

  it('a term found in the title and the other in content satisfies AND', async () => {
    const s = summary('mixed', { firstUserText: '中枢站改造' });
    await fs.writeFile(s.file, '今天调整了二网流量\n');
    s.sizeBytes = (await fs.stat(s.file)).size;
    const { matches } = await searchSessions([s], '中枢 二网', {});
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.text.includes('二网'))).toBe(true);
  });

  it('a session with only one of the terms never matches', async () => {
    const s = summary('half');
    await fs.writeFile(s.file, '只有 中枢 没有 别的词\n');
    s.sizeBytes = (await fs.stat(s.file)).size;
    const { matches } = await searchSessions([s], '中枢 二网', {});
    expect(matches).toHaveLength(0);
  });

  it('reports truncated when a large session was only tail-scanned', async () => {
    // >4MB session with the needle in its HEAD: the per-file cap skips the
    // head, so a miss must not be presented as a complete answer (spec D4).
    const big = summary('big');
    const filler = '{"type":"assistant"}' + 'x'.repeat(100) + '\n';
    let content = 'early Smart Heating mention\n';
    while (content.length < 4 * 1024 * 1024 + 1024) content += filler;
    await fs.writeFile(big.file, content);
    big.sizeBytes = (await fs.stat(big.file)).size;
    const small = summary('small', { lastModifiedMs: Date.now() - 1000 });
    await fs.writeFile(small.file, 'Smart Heating in small\n');
    small.sizeBytes = (await fs.stat(small.file)).size;
    const { matches, truncated } = await searchSessions([big, small], 'smart heating', {});
    expect(matches.map((m) => m.sessionId)).toContain('small');
    expect(truncated).toBe(true); // the big file's head was skipped
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
