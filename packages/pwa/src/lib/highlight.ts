export interface HighlightSegment {
  text: string;
  hit: boolean;
}

// Mirrors the daemon-side search semantics (case-insensitive substring), so
// the highlighted spans line up with what actually matched.
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let i = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) {
      segments.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) segments.push({ text: text.slice(i, idx), hit: false });
    segments.push({ text: text.slice(idx, idx + needle.length), hit: true });
    i = idx + needle.length;
  }
  return segments.filter((s) => s.text.length > 0);
}
