import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import type { SessionSummary } from '@ccferry/protocol';

export interface HistoryMatch {
  sessionId: string;
  projectPath: string;
  firstUserText: string;
  line: number;
  text: string;
  lastModifiedMs: number;
}

export interface HistoryResult {
  matches: HistoryMatch[];
  truncated: boolean;
}

const DEFAULT_BYTE_CAP = 20 * 1024 * 1024;
const PER_FILE_CAP = 4 * 1024 * 1024;
const LINE_TRUNCATE = 200;
const DEFAULT_LIMIT = 100;

// Capped full-text search over session JSONL files (spec D4): metadata
// filters first, title hits are free, content scans run newest-first under
// a cumulative byte budget so a 500MB store cannot stall the daemon.
export async function searchSessions(
  sessions: SessionSummary[],
  query: string,
  filter: { project?: string; days?: number; limit?: number; byteCapBytes?: number },
): Promise<HistoryResult> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], truncated: false };
  const minTime = filter.days ? Date.now() - filter.days * 86_400_000 : 0;
  const pool = sessions
    .filter((s) => (!filter.project || s.projectPath === filter.project) && s.lastModifiedMs >= minTime)
    .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const matches: HistoryMatch[] = [];
  let truncated = false;
  let budget = filter.byteCapBytes ?? DEFAULT_BYTE_CAP;
  for (const s of pool) {
    if (matches.length >= limit) break;
    const title = s.firstUserText.toLowerCase();
    if (title.includes(needle)) {
      matches.push({
        sessionId: s.sessionId,
        projectPath: s.projectPath,
        firstUserText: s.firstUserText,
        line: 0,
        text: s.firstUserText.slice(0, LINE_TRUNCATE),
        lastModifiedMs: s.lastModifiedMs,
      });
    }
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const readLen = Math.min(s.sizeBytes, budget, PER_FILE_CAP);
    if (readLen <= 0) continue;
    const from = s.sizeBytes > readLen ? s.sizeBytes - readLen : 0;
    let text: string;
    try {
      const handle = await fs.open(s.file, 'r');
      try {
        const buffer = Buffer.alloc(readLen);
        await handle.read(buffer, 0, readLen, from);
        text = buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      continue; // vanished or unreadable file — skip
    }
    budget -= readLen;
    if (readLen >= Math.min(s.sizeBytes, PER_FILE_CAP) && budget <= 0 && s !== pool.at(-1)) {
      truncated = true;
    }
    if (from > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) text = text.slice(firstNewline + 1);
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      const line = lines[i]!;
      if (line.toLowerCase().includes(needle)) {
        matches.push({
          sessionId: s.sessionId,
          projectPath: s.projectPath,
          firstUserText: s.firstUserText,
          line: i + 1,
          text: line.slice(0, LINE_TRUNCATE),
          lastModifiedMs: s.lastModifiedMs,
        });
      }
    }
  }
  return { matches, truncated };
}
