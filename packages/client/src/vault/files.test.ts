import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNote, readNote, writeNote } from './files';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-files-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('note file ops', () => {
  it('create → read → write round-trip, creating parent dirs', async () => {
    expect(await createNote(root, '笔记/新.md', '# new')).toBe('created');
    expect(await createNote(root, '笔记/新.md', '# again')).toBe('exists');
    const read = await readNote(root, '笔记/新.md');
    expect(read).toMatchObject({ status: 'ok', content: '# new' });
    expect(await writeNote(root, '笔记/新.md', '# edited')).toBe('ok');
    expect(await readNote(root, '笔记/新.md')).toMatchObject({ content: '# edited' });
  });

  it('reports missing and escape statuses', async () => {
    expect(await readNote(root, 'nope.md')).toMatchObject({ status: 'missing' });
    expect(await writeNote(root, 'nope.md', 'x')).toBe('missing');
    expect(await readNote(root, '../escape.md')).toMatchObject({ status: 'escape' });
    expect(await writeNote(root, '../escape.md', 'x')).toBe('escape');
    expect(await createNote(root, '../escape.md', 'x')).toBe('escape');
  });
});
