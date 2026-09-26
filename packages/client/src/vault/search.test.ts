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
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ path: 'notes/a.md', line: 2, text: 'Smart Heating here' });
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
});
