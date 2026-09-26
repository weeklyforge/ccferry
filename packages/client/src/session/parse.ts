import type { ParsedLine } from '@ccferry/protocol';

export function parseLine(raw: string, lineNo: number): ParsedLine {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, line: lineNo, raw };
  try {
    const json: unknown = JSON.parse(trimmed);
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, line: lineNo, raw };
    }
    return { ok: true, line: lineNo, json: json as Record<string, unknown> };
  } catch {
    return { ok: false, line: lineNo, raw };
  }
}

export function extractFirstUserText(json: Record<string, unknown>): string | null {
  if (json['type'] !== 'user') return null;
  const message = json['message'] as { content?: unknown } | undefined;
  if (!message) return null;
  const content = message['content'];
  if (typeof content === 'string') return content.slice(0, 200);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>)['type'] === 'text') {
        const text = (block as Record<string, unknown>)['text'];
        if (typeof text === 'string' && text.trim()) return text.slice(0, 200);
      }
    }
  }
  return null;
}
