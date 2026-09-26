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
