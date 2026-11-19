import { describe, expect, it } from 'vitest';
import { backlinksTo, noteTitle, pointsAt, refsOf } from './backlinks.ts';

const note = (path: string, text: string) => refsOf(path, text);

describe('noteTitle', () => {
  it('is the title property, else the first heading, else the file name', () => {
    expect(noteTitle('a/x.md', '---\ntitle: "Harbour notes"\n---\n# Other\n')).toBe('Harbour notes');
    expect(noteTitle('a/x.md', 'Intro\n\n# The Lantern #\ntext')).toBe('The Lantern');
    expect(noteTitle('a/x.md', '```\n# not a heading\n```\ntext')).toBe('x');
    expect(noteTitle('a/Soil.md', 'no heading')).toBe('Soil');
  });
});

describe('pointsAt', () => {
  const files = ['index.md', 'garden/Soil.md', 'garden/plants.md', 'other/Soil.md'];
  it('matches a wiki link by file name, with alias, anchor and case ignored', () => {
    expect(pointsAt('garden/plants.md', 'Plants', 'index.md', ['[[plants]]'], files)).toBe(true);
    expect(pointsAt('garden/plants.md', 'Plants', 'index.md', ['[[Plants#Roots|the roots]]'], files)).toBe(true);
    expect(pointsAt('garden/plants.md', 'Plants', 'index.md', ['[[garden/plants]]'], files)).toBe(true);
  });
  it('matches a wiki link written as the title, even when the title is not the file name', () => {
    expect(pointsAt('garden/plants.md', 'Green things', 'index.md', ['[[green things]]'], files)).toBe(true);
    expect(pointsAt('garden/plants.md', 'Green things', 'index.md', ['[[Soil]]'], files)).toBe(false);
  });
  it('follows the same nearest-first rule as the reader for two notes of one name', () => {
    expect(pointsAt('garden/Soil.md', 'Soil', 'garden/plants.md', ['[[Soil]]'], files)).toBe(true);
    expect(pointsAt('other/Soil.md', 'Soil', 'garden/plants.md', ['[[Soil]]'], files)).toBe(false);
  });
  it('matches a relative Markdown link', () => {
    expect(pointsAt('garden/Soil.md', 'Soil', 'garden/plants.md', ['Soil.md#x'], files)).toBe(true);
    expect(pointsAt('garden/Soil.md', 'Soil', 'index.md', ['garden/Soil.md'], files)).toBe(true);
    expect(pointsAt('garden/Soil.md', 'Soil', 'index.md', ['other/Soil.md'], files)).toBe(false);
  });
});

describe('backlinksTo', () => {
  const all = [
    note('index.md', '# Home\n\nSee [[Plants]] and [soil](garden/Soil.md).\n'),
    note('garden/plants.md', '---\ntitle: Plants\n---\nBack to [[index]]. Self: [[plants]].\n'),
    note('garden/Soil.md', '# Soil\n\nFor [[Plants]]; also `[[Plants]]` in code is not a link.\n'),
    note('zeta.md', 'No links here.\n'),
    note('alpha.md', '```\n[[Plants]]\n```\n'),
  ];
  it('lists the notes that link to the target, by title, without the target itself or links in code', () => {
    expect(backlinksTo('garden/plants.md', 'Plants', all)).toEqual([
      { path: 'index.md', title: 'Home' },
      { path: 'garden/Soil.md', title: 'Soil' },
    ]);
    expect(backlinksTo('index.md', 'Home', all)).toEqual([{ path: 'garden/plants.md', title: 'Plants' }]);
    expect(backlinksTo('zeta.md', 'zeta', all)).toEqual([]);
  });
});
