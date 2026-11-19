import { describe, expect, it } from 'vitest';
import { chips, countWords, dwell, orp, properties, slug, sourceLink, splitFront } from './text.ts';

describe('front matter', () => {
  it('splits a block off the top, reading CRLF as LF', () => {
    expect(splitFront('---\ntitle: A\n---\n# Body\n')).toEqual({ front: 'title: A', body: '# Body\n' });
    expect(splitFront('---\r\ntitle: A\r\n---\r\ntext').body).toBe('text');
    expect(splitFront('# No front\n---\nnot: front\n---\n').front).toBeNull();
    expect(splitFront('---\nunterminated: yes\n').front).toBeNull();
  });
  it('reads properties, lists joined, quotes and empties dropped', () => {
    const p = properties('title: "A day"\ntags: [one, two]\nauthors:\n  - Ada\n  - Bo\nempty:\nnote: [[Some page]]\n  indented: x');
    expect(p).toEqual([['title', 'A day'], ['tags', 'one · two'], ['authors', 'Ada · Bo'], ['note', '[[Some page]]']]);
  });
  it('finds the web link, link then url then source first', () => {
    expect(sourceLink([['source', 'https://example.com/s'], ['url', 'https://example.com/u']])).toBe('https://example.com/u');
    expect(sourceLink([['title', 'x'], ['Source', 'https://example.com/s'], ['other', 'https://example.com/o']])).toBe('https://example.com/s');
    expect(sourceLink([['link', 'https://example.com/l'], ['url', 'https://example.com/u']])).toBe('https://example.com/l');
    expect(sourceLink([['tags', 'a · b'], ['site', 'https://example.com/o · more']])).toBe('https://example.com/o');
    expect(sourceLink([['url', 'javascript:alert(1)'], ['link', 'ftp://example.com/x']])).toBeNull();
    expect(sourceLink([])).toBeNull();
  });
});

describe('play timing', () => {
  it('puts the pivot letter by word length', () => {
    expect([orp('a'), orp('word'), orp('reading'), orp('understanding'), orp('internationalization')]).toEqual([0, 1, 2, 3, 4]);
  });
  it('stays a word at the speed, longer at punctuation and for long words when pauses are on', () => {
    expect(dwell('word', 300, false)).toBe(200);
    expect(dwell('end.', 300, false)).toBe(200);
    expect(dwell('end.', 300, true)).toBeCloseTo(440);
    expect(dwell('well,', 300, true)).toBeCloseTo(300);
    expect(dwell('understanding', 300, true)).toBeCloseTo(260);
    expect(dwell('x', 0, false)).toBe(60_000);
  });
});

describe('slug and word count', () => {
  it('makes heading anchors', () => {
    expect(slug('  A Heading, with Punctuation! ')).toBe('a-heading-with-punctuation');
    expect(slug('Ação e reação')).toBe('ação-e-reação');
  });
  it('counts words, not symbols', () => {
    expect(countWords('One two — three\n\n- four, 5 ***')).toBe(5);
  });
});

describe('chips', () => {
  it('makes one chip per tag and one per other property, without the title', () => {
    const p = properties('title: Harbour\ntype: essay\ntags: [sea, "#stairs"]\nstatus: draft');
    expect(chips(p)).toEqual([
      { key: 'type', value: 'essay', tag: false },
      { key: 'tags', value: 'sea', tag: true },
      { key: 'tags', value: 'stairs', tag: true },
      { key: 'status', value: 'draft', tag: false },
    ]);
  });
  it('joins list values and caps the count', () => {
    expect(chips([['authors', 'A · B']])).toEqual([{ key: 'authors', value: 'A, B', tag: false }]);
    expect(chips(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v'] as [string, string]), 5)).toHaveLength(5);
  });
});
