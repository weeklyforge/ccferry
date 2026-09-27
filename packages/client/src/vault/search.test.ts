import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsSearchEngine } from './search';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-search-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createJsSearchEngine', () => {
  it('finds case-insensitive literal matches with line numbers', async () => {
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(path.join(root, 'notes', 'a.md'), 'nothing\nSmart Heating here\n');
    await fs.writeFile(path.join(root, 'b.md'), 'smart heating again\n');
    const engine = createJsSearchEngine();
    const matches = await engine.search(root, 'smart heating');
    expect(matches.map((m) => m.path).sort()).toEqual(['b.md', 'notes/a.md']);
    expect(matches.find((m) => m.path === 'notes/a.md')).toEqual({
      path: 'notes/a.md',
      line: 2,
      text: 'Smart Heating here',
    });
  });

  it('returns an empty array for a blank query', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'smart');
    expect(await createJsSearchEngine().search(root, '   ')).toEqual([]);
  });

  it('ignores non-md files and caps long lines', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'smart heating');
    await fs.writeFile(path.join(root, 'a.md'), 'x'.repeat(500) + ' smart heating');
    const matches = await createJsSearchEngine().search(root, 'smart heating');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.text.length).toBeLessThanOrEqual(200);
  });

  it('matches uppercase .MD extensions too (minor 10)', async () => {
    await fs.writeFile(path.join(root, 'upper.MD'), 'smart heating\n');
    const matches = await createJsSearchEngine().search(root, 'smart heating');
    expect(matches.map((m) => m.path)).toEqual(['upper.MD']);
  });

  it('ANDs space-separated terms at the note level: terms may sit on different lines', async () => {
    await fs.writeFile(path.join(root, 'both.md'), '中枢站运行规程\n与调度有关\n二网流量调整\n');
    await fs.writeFile(path.join(root, 'one.md'), '只有 中枢 没有别的\n');
    const matches = await createJsSearchEngine().search(root, '中枢 二网');
    expect(matches.map((m) => m.path)).toEqual(['both.md', 'both.md']);
    expect(matches.map((m) => m.line)).toEqual([1, 3]);
  });

  it('a note with only one of the terms never matches', async () => {
    await fs.writeFile(path.join(root, 'half.md'), '二网 出现\n二网 又出现\n');
    expect(await createJsSearchEngine().search(root, '中枢 二网')).toEqual([]);
  });
});
