import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from './sandbox';

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
