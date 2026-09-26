import type { ParsedLine } from '@ccferry/protocol';

export type Bubble =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'raw'; text: string };

export function parsedLineToBubble(p: ParsedLine): Bubble | null {
  if (!p.ok) return p.raw.trim() ? { kind: 'raw', text: p.raw.slice(0, 200) } : null;
  const json = p.json;
  const type = json['type'];
  if (type !== 'user' && type !== 'assistant') return null;
  const message = json['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.trim() ? { kind: 'text', role: type, text: content.slice(0, 2000) } : null;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['type'] === 'text' && typeof record['text'] === 'string' && record['text'].trim()) {
        return { kind: 'text', role: type, text: record['text'].slice(0, 2000) };
      }
      if (record['type'] === 'tool_use' && typeof record['name'] === 'string') {
        return { kind: 'tool', name: record['name'] };
      }
    }
  }
  return null;
}
