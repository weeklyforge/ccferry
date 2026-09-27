// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightKeywordsInElement } from './highlight';

function build(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = '<p>the <b>Smart</b> Heating plan</p><p>unrelated</p>';
  return root;
}

describe('highlightKeywordsInElement', () => {
  it('wraps every term in mark, across element boundaries', () => {
    const root = build();
    highlightKeywordsInElement(root, ['smart', 'heating']);
    expect(root.querySelectorAll('mark').length).toBe(2);
    expect(root.querySelector('mark')?.textContent).toBe('Smart');
    expect(root.querySelectorAll('p')[1]?.innerHTML).toBe('unrelated');
  });

  it('is a no-op without terms', () => {
    const root = build();
    highlightKeywordsInElement(root, []);
    expect(root.querySelectorAll('mark').length).toBe(0);
  });

  it('does not touch attributes or tag names', () => {
    const root = build();
    highlightKeywordsInElement(root, ['smart']);
    expect(root.querySelector('b mark')?.textContent).toBe('Smart');
    expect(root.querySelectorAll('p').length).toBe(2);
  });
});
