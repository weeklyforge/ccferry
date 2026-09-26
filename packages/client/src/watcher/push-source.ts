import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import type { SessionSummary } from '@ccferry/protocol';
import type { ScanFn } from '../session/scan-cache';

export interface ResultEvent {
  kind: 'result';
  sessionId: string;
  ok: boolean;
  excerpt: string;
  at: number;
}

export interface PushSourceOptions {
  claudeDir: string;
  scan: ScanFn;
  pollMs?: number;
  onEvent: (event: ResultEvent) => void;
  log?: (message: string) => void;
}

const EXCERPT_LEN = 80;

// Polls the session store for growth and emits one event per newly appended
// `result` line — the single source of truth for completion/error, covering
// both TUI and daemon-driven sessions. The per-file offset only advances past
// complete (newline-terminated) lines, so a line split across polls is parsed
// once, on the poll where it completes. First sight of a file only seeds its
// size: results that predate the daemon are old news.
export class PushSource {
  private readonly offsets = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly opts: PushSourceOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.running) return; // a slow scan must not pile up
    this.running = true;
    try {
      const { sessions } = await this.opts.scan(this.opts.claudeDir);
      for (const s of sessions) {
        const known = this.offsets.get(s.file);
        if (known === undefined || s.sizeBytes < known) {
          this.offsets.set(s.file, s.sizeBytes); // seed or rotation — never emit
          continue;
        }
        if (s.sizeBytes === known) continue;
        await this.scanGrowth(s, known);
      }
    } catch (error) {
      this.opts.log?.(`push-source poll failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async scanGrowth(s: SessionSummary, fromByte: number): Promise<void> {
    const handle = await fs.open(s.file, 'r');
    try {
      const length = s.sizeBytes - fromByte;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, fromByte);
      const text = buffer.toString('utf8');
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline === -1) return; // nothing complete yet — offset unchanged
      this.offsets.set(s.file, fromByte + lastNewline + 1);
      const completeText = text.slice(0, lastNewline + 1);
      for (const raw of completeText.split('\n')) {
        const event = parseResultLine(raw, s);
        if (event) this.opts.onEvent(event);
      }
    } catch {
      // unreadable window — the next poll retries from the same offset
    } finally {
      await handle.close();
    }
  }
}

export function parseResultLine(raw: string, s: SessionSummary): ResultEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    if (json['type'] !== 'result' || typeof json['session_id'] !== 'string') return null;
    const result = json['result'];
    const excerpt =
      typeof result === 'string' && result.trim()
        ? result.slice(0, EXCERPT_LEN)
        : (s.firstUserText || '').slice(0, EXCERPT_LEN);
    return {
      kind: 'result',
      sessionId: json['session_id'],
      ok: json['subtype'] === 'success',
      excerpt,
      at: Date.now(),
    };
  } catch {
    return null;
  }
}
