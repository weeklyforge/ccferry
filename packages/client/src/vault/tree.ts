import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultNode } from '@ccferry/protocol';

export const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules']);

export async function readTree(root: string): Promise<VaultNode[]> {
  return walk(root, '');
}

async function walk(dir: string, prefix: string): Promise<VaultNode[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  const nodes: VaultNode[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, kind: 'dir', children: await walk(path.join(dir, entry.name), rel) });
    } else if (entry.isFile()) {
      const stat = await fs.stat(path.join(dir, entry.name));
      nodes.push({ name: entry.name, path: rel, kind: 'file', sizeBytes: stat.size });
    }
  }
  return nodes;
}
