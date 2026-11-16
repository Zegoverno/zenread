// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bionic, takeChangelog, units, wrapWords } from './dom.ts';
import { render } from './md.ts';

describe('reading aids on the DOM', () => {
  it('wraps words, not code, and counts them', () => {
    const { el } = render('One two, three!\n\n`skip this` and ... **bold**\n\n```\nnot words\n```\n');
    const words = wrapWords(el);
    expect(words.map((w) => w.textContent)).toEqual(['One', 'two,', 'three!', 'and', 'bold']);
    expect(el.querySelector('pre span.w, code span.w')).toBeNull();
  });

  it('takes the changelog heading and all after it apart', () => {
    const { el } = render('# T\n\ntext\n\n## Changelog\n\n- one\n- two\n');
    const log = takeChangelog(el)!;
    expect(log.textContent).toContain('one');
    expect(el.textContent).not.toContain('Changelog');
    expect(el.textContent).not.toContain('one');
    expect(takeChangelog(render('# No log').el)).toBeNull();
  });

  it('puts the start of each word in bold', () => {
    const { el } = render('Reading words quickly, a b');
    bionic(el);
    expect([...el.querySelectorAll('b.md-bionic')].map((b) => b.textContent)).toEqual(['Read', 'wor', 'quic', 'a', 'b']);
    expect(el.textContent).toBe('Reading words quickly, a b');
  });

  it('finds the blocks focus lights, outermost first (a list item shows as its paragraph)', () => {
    const { el } = render('# H\n\npara one\n\n- item a\n- item b\n\n| a |\n|---|\n| 1 |\n\n```\ncode\n```\n');
    const tags = units(el).map((u) => u.tagName);
    expect(tags).toEqual(['H1', 'P', 'P', 'P', 'TABLE', 'PRE']);
  });
});
