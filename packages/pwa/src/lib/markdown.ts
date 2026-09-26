import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { TokenizerAndRendererExtension } from 'marked';

// Obsidian wikilinks ([[note]] / [[note|alias]]) have no CommonMark meaning;
// render them as a highlighted, non-navigable span until vault-side jump
// support lands (M4).
const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!match) return undefined;
    return {
      type: 'wikilink',
      raw: match[0] ?? '',
      display: (match[2] ?? match[1] ?? '').trim(),
    };
  },
  renderer(token) {
    const display = (token as { display?: string }).display ?? '';
    return `<span class="wikilink">${escapeHtml(display)}</span>`;
  },
};

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({ extensions: [wikilink] });

// Session streaming re-renders the whole bubble list per incoming line;
// memoizing keeps long sessions from re-parsing every bubble each time.
const CACHE_MAX = 500;
const cache = new Map<string, string>();

export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  // Content comes from session transcripts and vault notes, which can quote
  // arbitrary HTML — sanitize before the caller hands it to v-html.
  const html = DOMPurify.sanitize(md.parse(text, { async: false }) as string);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, html);
  return html;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
