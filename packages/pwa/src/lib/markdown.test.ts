// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings as html elements', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
  });

  it('renders fenced code blocks', () => {
    expect(renderMarkdown('```\nconst x = 1;\n```')).toContain('<pre><code');
  });

  it('highlights fenced code with a known language', () => {
    const html = renderMarkdown('```typescript\nconst x = 1;\n```');
    expect(html).toContain('hljs language-typescript');
    expect(html).toContain('hljs-keyword');
  });

  it('renders unknown languages as escaped plain code', () => {
    const html = renderMarkdown('```notalang\nfoo <b>bar</b>\n```');
    expect(html).toContain('<pre><code');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('renders wikilinks as highlighted spans without brackets', () => {
    const html = renderMarkdown('see [[开发项目图谱]] here');
    expect(html).toContain('<span class="wikilink">开发项目图谱</span>');
    expect(html).not.toContain('[[');
  });

  it('shows the display alias for piped wikilinks', () => {
    expect(renderMarkdown('[[开发项目图谱|图谱]]')).toContain('<span class="wikilink">图谱</span>');
  });

  it('escapes html inside wikilink names', () => {
    expect(renderMarkdown('[[a<b>c]]')).toContain('&lt;b&gt;');
    expect(renderMarkdown('[[a<b>c]]')).not.toContain('<b>');
  });

  it('strips script tags', () => {
    expect(renderMarkdown('hi <script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips event handler attributes', () => {
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
  });

  it('returns the cached html for repeated input', () => {
    expect(renderMarkdown('same **bold** input')).toBe(renderMarkdown('same **bold** input'));
  });
});
