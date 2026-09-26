import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultNode, VaultSearchMatch } from '@ccferry/protocol';
import { readTree } from './tree';

export interface SearchEngine {
  search(root: string, query: string): Promise<VaultSearchMatch[]>;
}

const MAX_PER_FILE = 20;
const MAX_TOTAL = 200;
const LINE_TRUNCATE = 200;

// Pure-JS engine: the measured vault is ~317 md files / ~481KB, so a full
// scan per query lands in the tens of milliseconds. Swapping in ripgrep
// later means implementing this interface only (spec D2).
export function createJsSearchEngine(): SearchEngine {
  return {
    async search(root: string, query: string): Promise<VaultSearchMatch[]> {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const matches: VaultSearchMatch[] = [];
      for (const abs of await collectMdFiles(root)) {
        if (matches.length >= MAX_TOTAL) break;
        let perFile = 0;
        let lineNo = 0;
        const content = await fs.readFile(abs, 'utf8');
        for (const line of content.split('\n')) {
          lineNo += 1;
          if (line.toLowerCase().includes(needle)) {
            matches.push({
              path: toRelative(root, abs),
              line: lineNo,
              text: line.slice(0, LINE_TRUNCATE),
            });
            perFile += 1;
            if (perFile >= MAX_PER_FILE) break;
          }
        }
      }
      return matches.slice(0, MAX_TOTAL);
    },
  };
}

async function collectMdFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(nodes: VaultNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.kind === 'file' && node.name.toLowerCase().endsWith('.md')) files.push(path.join(root, node.path));
      if (node.children) await visit(node.children);
    }
  }
  await visit(await readTree(root));
  return files;
}

function toRelative(root: string, abs: string): string {
  return abs.slice(path.resolve(root).length + 1).replaceAll('\\', '/');
}
