import type { ParsedLine } from '@ccferry/protocol';

// Local wall-clock label for the bubble: HH:mm today, MM-DD HH:mm otherwise.
function fmtTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mo}-${dd} ${time}`;
}

export type Bubble =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; ts?: string }
  | { kind: 'tool'; name: string; ts?: string }
  | { kind: 'raw'; text: string };

export function parsedLineToBubble(p: ParsedLine): Bubble | null {
  if (!p.ok) return p.raw.trim() ? { kind: 'raw', text: p.raw.slice(0, 200) } : null;
  const json = p.json;
  const type = json['type'];
  if (type !== 'user' && type !== 'assistant') return null;
  const ts = typeof json['timestamp'] === 'string' ? fmtTime(json['timestamp']) : undefined;
  const message = json['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.trim() ? { kind: 'text', role: type, text: content.slice(0, 2000), ts } : null;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['type'] === 'text' && typeof record['text'] === 'string' && record['text'].trim()) {
        return { kind: 'text', role: type, text: record['text'].slice(0, 2000), ts };
      }
      if (record['type'] === 'tool_use' && typeof record['name'] === 'string') {
        return { kind: 'tool', name: record['name'], ts };
      }
    }
  }
  return null;
}
