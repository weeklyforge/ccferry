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
  | { kind: 'tool'; name: string; summary: string; toolUseId?: string; ts?: string }
  | { kind: 'raw'; text: string };

// One-line gist for the collapsed tool row: the parameter a human scans for.
function toolSummary(name: string, input: Record<string, unknown>): string {
  const file = input['file_path'] ?? input['notebook_path'];
  if (typeof file === 'string') {
    const segments = file.split(/[\\/]/);
    return segments[segments.length - 1] ?? file;
  }
  const command = input['command'];
  if (typeof command === 'string') return command.replace(/\s+/g, ' ').slice(0, 90);
  const pattern = input['pattern'] ?? input['query'] ?? input['url'] ?? input['description'];
  if (typeof pattern === 'string') return pattern.slice(0, 90);
  const json = JSON.stringify(input);
  return json === '{}' ? '' : json.slice(0, 90);
}

// Tool results ride the NEXT user line (content[].tool_result, paired by
// tool_use_id). Returns null when the line carries none.
export function extractToolResult(p: ParsedLine): { id: string; text: string; isError: boolean } | null {
  if (!p.ok) return null;
  const message = p.json['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record['type'] !== 'tool_result') continue;
    const id = typeof record['tool_use_id'] === 'string' ? record['tool_use_id'] : '';
    if (!id) continue;
    let text = '';
    const inner = record['content'];
    if (typeof inner === 'string') text = inner;
    else if (Array.isArray(inner)) {
      text = inner
        .map((b) => (b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'text' ? String((b as Record<string, unknown>)['text']) : ''))
        .join('\n');
    }
    return { id, text: text.slice(0, 4000), isError: record['is_error'] === true };
  }
  return null;
}

// One session line may carry several blocks (text + N tool calls), so a
// line maps to MULTIPLE bubbles.
export function parsedLineToBubbles(p: ParsedLine): Bubble[] {
  if (!p.ok) return p.raw.trim() ? [{ kind: 'raw', text: p.raw.slice(0, 200) }] : [];
  const json = p.json;
  const type = json['type'];
  if (type !== 'user' && type !== 'assistant') return [];
  const ts = typeof json['timestamp'] === 'string' ? fmtTime(json['timestamp']) : undefined;
  const message = json['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', role: type, text: content.slice(0, 2000), ts }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: Bubble[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string' && record['text'].trim()) {
      out.push({ kind: 'text', role: type, text: record['text'].slice(0, 2000), ts });
    }
    if (record['type'] === 'tool_use' && typeof record['name'] === 'string') {
      const input = (record['input'] ?? {}) as Record<string, unknown>;
      const toolUseId = typeof record['id'] === 'string' ? record['id'] : undefined;
      out.push({ kind: 'tool', name: record['name'], summary: toolSummary(record['name'], input), toolUseId, ts });
    }
  }
  return out;
}
