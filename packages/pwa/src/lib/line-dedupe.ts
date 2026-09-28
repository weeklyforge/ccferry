import type { ParsedLine } from '@ccferry/protocol';

// Remembers which session lines are already on screen so a tailed replay
// after an SSE reconnect is skipped instead of clearing and redrawing the
// view (the visible "content flashes every few seconds" symptom).
export class LineDedupe {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 600) {}

  // True when the line was NOT seen before (caller should render it).
  firstOf(line: ParsedLine): boolean {
    const key = this.keyOf(line);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > this.capacity) {
      for (const dropped of this.order.splice(0, Math.floor(this.capacity / 3))) this.seen.delete(dropped);
    }
    return true;
  }

  private keyOf(line: ParsedLine): string {
    if (line.ok) {
      const uuid = line.json['uuid'];
      if (typeof uuid === 'string') return 'u' + uuid;
      return 'j' + JSON.stringify(line.json).slice(0, 256);
    }
    return 'r' + line.raw.slice(0, 256);
  }

  reset(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
