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
      // Space-separated terms AND at the NOTE level (same rule as history
      // search): every term must appear somewhere in the note; result rows
      // are the lines holding any of the terms.
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];
      const matches: VaultSearchMatch[] = [];
      for (const abs of await collectMdFiles(root)) {
        if (matches.length >= MAX_TOTAL) break;
        const rel = toRelative(root, abs);
        const seen = new Set<string>();
        const rows: VaultSearchMatch[] = [];
        let lineNo = 0;
        const content = await fs.readFile(abs, 'utf8');
        for (const line of content.split('\n')) {
          lineNo += 1;
          const lower = line.toLowerCase();
          let lineHas = false;
          for (const term of terms) {
            if (term && lower.includes(term)) {
              seen.add(term);
              lineHas = true;
            }
          }
          if (lineHas && rows.length < MAX_PER_FILE) {
            rows.push({ path: rel, line: lineNo, text: line.slice(0, LINE_TRUNCATE) });
          }
          if (seen.size === terms.length && rows.length >= MAX_PER_FILE) break;
        }
        if (seen.size === terms.length) matches.push(...rows);
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
