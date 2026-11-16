import { describe, expect, it } from 'vitest';
import { anchorOf, byName, collectRefs, neighbours, normalizePath, resolveAll, resolveRelative, resolveWiki, wikiKey } from './links.ts';

const files = ['index.md', 'garden/plants.md', 'garden/Soil.md', 'garden/deep/Soil.md', 'notes/soil.md', 'notes/day2.md', 'notes/day10.md', 'notes/day1.md', 'notes/readme.txt'];

describe('paths', () => {
  it('folds dots and refuses to climb out', () => {
    expect(normalizePath('a/./b//c/../d')).toBe('a/b/d');
    expect(normalizePath('a/../..')).toBeNull();
    expect(normalizePath('../x')).toBeNull();
  });
  it('reads anchors', () => {
    expect(anchorOf('note.md#A%20b')).toBe('A b');
    expect(anchorOf('note.md')).toBe('');
    expect(anchorOf('#bad%')).toBe('bad%');
  });
});

describe('relative links', () => {
  it('resolve from the note, to notes only', () => {
    expect(resolveRelative('garden/plants.md', 'Soil.md')).toBe('garden/Soil.md');
    expect(resolveRelative('garden/plants.md', '../notes/day1.md#top')).toBe('notes/day1.md');
    expect(resolveRelative('garden/plants.md', '/index.md')).toBe('index.md');
    expect(resolveRelative('garden/plants.md', 'deep/Soil.md?x=1')).toBe('garden/deep/Soil.md');
    expect(resolveRelative('garden/plants.md', 'my%20note.md')).toBe('garden/my note.md');
  });
  it('refuse webs, anchors, other files and escapes', () => {
    for (const h of ['https://example.com/a.md', 'mailto:a@b.c', '#top', '//host/a.md', 'pic.png', '../../x.md', '', 'javascript:alert(1)'])
      expect(resolveRelative('garden/plants.md', h), h).toBeNull();
  });
});

describe('wiki links', () => {
  it('match a bare name, nearest first, ignoring case and extension', () => {
    expect(resolveWiki('soil', 'garden/plants.md', files)).toBe('garden/Soil.md');
    expect(resolveWiki('Soil', 'notes/day1.md', files)).toBe('notes/soil.md');
    expect(resolveWiki('soil.md', 'index.md', files)).toBe('garden/Soil.md'); // fewest folders, then alphabetical
    expect(resolveWiki('plants|the plants', 'index.md', files)).toBe('garden/plants.md');
    expect(resolveWiki('plants#Care', 'index.md', files)).toBe('garden/plants.md');
  });
  it('match a path from the root, from the note, or as a tail', () => {
    expect(resolveWiki('garden/plants', 'index.md', files)).toBe('garden/plants.md');
    expect(resolveWiki('deep/soil', 'garden/plants.md', files)).toBe('garden/deep/Soil.md');
    expect(resolveWiki('deep/soil', 'index.md', files)).toBe('garden/deep/Soil.md');
  });
  it('return null for nothing, an anchor only, or a missing note', () => {
    expect(resolveWiki('', 'index.md', files)).toBeNull();
    expect(resolveWiki('#only', 'index.md', files)).toBeNull();
    expect(resolveWiki('ghost', 'index.md', files)).toBeNull();
    expect(resolveWiki('readme', 'index.md', files)).toBeNull();
  });
});

describe('collecting and resolving', () => {
  const md = 'See [[Soil|the soil]] and [[plants#Care]], [day](../notes/day1.md) and [web](https://example.com/a.md).\n![pic](a.png) [top](#x)\n`[[in code]]`\n\n```\n[[fenced]] [x](fenced.md)\n```\n[a](<my note.md> "t") [[Soil]]';
  it('lists wiki and relative targets once, skipping code, webs, anchors and images', () => {
    expect(collectRefs(md)).toEqual([wikiKey('Soil'), wikiKey('plants#Care'), '../notes/day1.md', 'my note.md']);
  });
  it('resolves each', () => {
    expect(resolveAll('garden/plants.md', md, files)).toEqual({
      '[[Soil]]': 'garden/Soil.md',
      '[[plants#Care]]': 'garden/plants.md',
      '../notes/day1.md': 'notes/day1.md',
      'my note.md': null,
    });
  });
  it('does not fuzzy-match a missing relative link', () => {
    expect(resolveAll('index.md', '[x](gone/soil.md)', files)).toEqual({ 'gone/soil.md': null });
  });
});

describe('neighbours', () => {
  it('order a folder naturally and give the note before and after', () => {
    expect(neighbours('notes/day2.md', files)).toEqual({ prev: 'notes/day1.md', next: 'notes/day10.md' });
    expect(neighbours('notes/day1.md', files).prev).toBeNull();
    expect(neighbours('notes/soil.md', files).next).toBeNull();
    expect(neighbours('index.md', files)).toEqual({ prev: null, next: null });
    expect(neighbours('missing.md', files)).toEqual({ prev: null, next: null });
  });
  it('sort names naturally', () => {
    expect(['b10.md', 'B2.md', 'a.md'].sort(byName)).toEqual(['a.md', 'B2.md', 'b10.md']);
  });
});
