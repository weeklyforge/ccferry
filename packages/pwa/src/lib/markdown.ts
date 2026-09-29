import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import 'highlight.js/styles/github.css';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import type { TokenizerAndRendererExtension } from 'marked';

// Languages that actually appear in session transcripts and vault notes;
// anything else falls back to escaped plaintext. Keeps the bundle small —
// the full common bundle costs ~330KB gzip over the tunnel on every cold load.
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

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
// highlight.js common-language bundle; unknown languages fall back to
// plaintext so a stray fence never breaks rendering.
md.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);
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
