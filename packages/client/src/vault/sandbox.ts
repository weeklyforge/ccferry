import { promises as fs } from 'node:fs';
import path from 'node:path';

// Single entry point for every vault file operation: resolve a vault-relative
// path against the root, or return null when it would escape the root.
export function resolveInside(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath === '') return null;
  const normalized = relPath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return null;
  if (segments.length === 0) return null; // the root itself is not a note path
  const abs = path.resolve(root, ...segments);
  const rel = path.relative(path.resolve(root), abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

// Lexical checks first (fast rejects), then realpath the deepest EXISTING
// ancestor and verify containment — a symlink planted inside the vault
// cannot escape the real root (M3 spec 4), while not-yet-existing note
// paths still resolve (createNote needs them).
export async function resolveInsideReal(root: string, relPath: string): Promise<string | null> {
  const abs = resolveInside(root, relPath);
  if (!abs) return null;
  const realRoot = await fs.realpath(path.resolve(root)).catch(() => null);
  if (realRoot === null) return null;
  const tail: string[] = [];
  let dir = abs;
  for (;;) {
    const realDir = await fs.realpath(dir).catch(() => null);
    if (realDir !== null) {
      const rel = path.relative(realRoot, realDir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // escapes the real root
      return path.join(realDir, ...tail);
    }
    tail.unshift(path.basename(dir));
    const parent = path.dirname(dir);
    if (parent === dir) return null; // walked past the filesystem root
    dir = parent;
  }
}
