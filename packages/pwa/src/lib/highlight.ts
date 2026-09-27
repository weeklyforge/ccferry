export interface HighlightSegment {
  text: string;
  hit: boolean;
}

// Search queries AND on whitespace-separated terms; every term must appear.
export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export interface TextRange {
  start: number;
  end: number;
}

// Non-overlapping match ranges for every term, sorted, merged on overlap.
// Mirrors the daemon's AND search so highlighted spans line up with hits.
export function findRanges(text: string, terms: string[]): TextRange[] {
  if (terms.length === 0) return [];
  const lower = text.toLowerCase();
  const found: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      found.push({ start: idx, end: idx + term.length });
      from = idx + term.length;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: TextRange[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) { // overlap OR adjacency → one span
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = queryTerms(query);
  const ranges = findRanges(text, terms);
  if (ranges.length === 0) return [{ text, hit: false }];
  const segments: HighlightSegment[] = [];
  let pos = 0;
  for (const { start, end } of ranges) {
    if (start > pos) segments.push({ text: text.slice(pos, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), hit: false });
  return segments;
}

// In-place DOM highlighting for rendered pages (e.g. a session opened from
// search): wraps every term occurrence in <mark> by walking TEXT nodes, so
// markdown-rendered HTML keeps its structure.
export function highlightKeywordsInElement(root: ParentNode, terms: string[]): void {
  if (terms.length === 0) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    if (terms.some((t) => t && value.toLowerCase().includes(t))) targets.push(node as Text);
  }
  for (const node of targets) {
    const value = node.nodeValue ?? '';
    const ranges = findRanges(value, terms);
    if (ranges.length === 0 || !node.parentNode) continue;
    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const { start, end } of ranges) {
      if (start > pos) fragment.append(value.slice(pos, start));
      const mark = document.createElement('mark');
      mark.textContent = value.slice(start, end);
      fragment.append(mark);
      pos = end;
    }
    if (pos < value.length) fragment.append(value.slice(pos));
    node.parentNode.replaceChild(fragment, node);
  }
}
