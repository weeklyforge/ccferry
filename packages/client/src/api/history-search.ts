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
const MAX_PER_SESSION = 3;

// Capped full-text search over session JSONL files (spec D4): metadata
// filters first, title hits are free, content scans run newest-first under
// a cumulative byte budget so a 500MB store cannot stall the daemon.
export async function searchSessions(
  sessions: SessionSummary[],
  query: string,
  filter: { project?: string; days?: number; limit?: number; byteCapBytes?: number },
): Promise<HistoryResult> {
  // Space-separated terms AND together: a hit must contain every term.
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { matches: [], truncated: false };
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
    // Session-level AND (spec D4): every term must appear SOMEWHERE in the
    // session — title or any scanned line — not on one line. Terms on
    // different lines is the normal case for multi-keyword recall.
    const title = s.firstUserText.toLowerCase();
    const seen = new Set<string>();
    for (const t of terms) if (title.includes(t)) seen.add(t);
    const titleHasAll = seen.size === terms.length;
    const titleRow: HistoryMatch | null = titleHasAll
      ? {
          sessionId: s.sessionId,
          projectPath: s.projectPath,
          firstUserText: s.firstUserText,
          line: 0,
          text: s.firstUserText.slice(0, LINE_TRUNCATE),
          lastModifiedMs: s.lastModifiedMs,
        }
      : null;
    const rows: HistoryMatch[] = [];
    if (budget > 0) {
      const readLen = Math.min(s.sizeBytes, budget, PER_FILE_CAP);
      if (readLen > 0) {
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
          text = ''; // vanished or unreadable file — title evidence still counts
        }
        budget -= readLen;
        // A skipped head (per-file cap or budget exhausted mid-file) means the
        // answer is incomplete — never present a partial scan as full (spec D4).
        if (from > 0) truncated = true;
        if (from > 0) {
          const firstNewline = text.indexOf('\n');
          if (firstNewline !== -1) text = text.slice(firstNewline + 1);
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const lower = line.toLowerCase();
          let lineHas = false;
          for (const t of terms) {
            if (t && lower.includes(t)) {
              seen.add(t);
              lineHas = true;
            }
          }
          // Context rows carry lines holding ANY term (each proves the
          // session hit); cap keeps one broad session from flooding results.
          if (lineHas && rows.length < MAX_PER_SESSION) {
            rows.push({
              sessionId: s.sessionId,
              projectPath: s.projectPath,
              firstUserText: s.firstUserText,
              line: i + 1,
              text: line.slice(0, LINE_TRUNCATE),
              lastModifiedMs: s.lastModifiedMs,
            });
          }
          if (seen.size === terms.length && rows.length >= MAX_PER_SESSION) break;
        }
      } else {
        truncated = true;
      }
    } else {
      truncated = true;
    }
    if (seen.size < terms.length) continue; // AND not satisfied — no rows
    if (titleRow) matches.push(titleRow);
    for (const row of rows) {
      if (matches.length >= limit) break;
      matches.push(row);
    }
  }
  return { matches, truncated };
}
