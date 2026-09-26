import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside, resolveInsideReal } from './sandbox';

const ROOT = path.resolve('/vault-root');

describe('resolveInside (Review Focus 1)', () => {
  it('resolves a normal relative path', () => {
    expect(resolveInside(ROOT, '工作日报/2026-09/a.md')).toBe(path.join(ROOT, '工作日报', '2026-09', 'a.md'));
  });

  it('accepts backslash separators but rejects escapes', () => {
    expect(resolveInside(ROOT, 'dir\\file.md')).toBe(path.join(ROOT, 'dir', 'file.md'));
  });

  it('rejects traversal, absolute and drive-letter paths', () => {
    expect(resolveInside(ROOT, '../outside.md')).toBeNull();
    expect(resolveInside(ROOT, 'dir/../../outside.md')).toBeNull();
    expect(resolveInside(ROOT, '..\\outside.md')).toBeNull();
    expect(resolveInside(ROOT, '/etc/passwd')).toBeNull();
    expect(resolveInside(ROOT, 'C:/windows/system32')).toBeNull();
    expect(resolveInside(ROOT, 'C:\\windows')).toBeNull();
  });

  it('rejects empty paths and the root itself', () => {
    expect(resolveInside(ROOT, '')).toBeNull();
    expect(resolveInside(ROOT, '.')).toBeNull();
  });
});

describe('resolveInsideReal (symlink escape)', () => {
  it('rejects a symlink that points outside the root', async ({ skip }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-real-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-out-'));
    await fs.writeFile(path.join(outside, 'secret.md'), 'x');
    try {
      await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'link.md'));
    } catch {
      skip('symlink permission unavailable');
      return;
    }
    try {
      expect(await resolveInsideReal(root, 'link.md')).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('still resolves regular paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-real-'));
    try {
      const resolved = await resolveInsideReal(root, 'a/b.md');
      expect(resolved).toBe(path.join(root, 'a', 'b.md'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
