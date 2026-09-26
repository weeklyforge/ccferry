import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTree } from './tree';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-vault-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('readTree', () => {
  it('builds nested nodes and skips ignored dirs', async () => {
    await fs.mkdir(path.join(root, '日报', '2026-09'), { recursive: true });
    await fs.writeFile(path.join(root, '日报', '2026-09', 'a.md'), 'hello');
    await fs.writeFile(path.join(root, 'top.md'), 'x');
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'config'), 'x');
    const tree = await readTree(root);
    expect(tree.map((n) => n.path).sort()).toEqual(['top.md', '日报']);
    const dir = tree.find((n) => n.kind === 'dir');
    expect(dir?.children?.[0]).toMatchObject({ path: '日报/2026-09', kind: 'dir' });
    const file = dir?.children?.[0]?.children?.[0];
    expect(file).toMatchObject({ path: '日报/2026-09/a.md', kind: 'file', sizeBytes: 5 });
  });
});
