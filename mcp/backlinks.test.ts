import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Backlinks } from './backlinks.ts';
import { Files } from './files.ts';

let dir: string, root: string, files: Files, back: Backlinks;
const put = (rel: string, text: string, base = root) => {
  mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  writeFileSync(path.join(base, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zenread-back-'));
  root = path.join(dir, 'vault');
  mkdirSync(root);
  put('index.md', '# Home\n\nSee [[Plants]], [[Green things]] and [soil](garden/Soil.md).\n');
  put('garden/plants.md', '---\ntitle: Green things\n---\nBack to [[index]].\n');
  put('garden/Soil.md', '# Soil\n\nFor [[plants|the plants]].\n');
  put('.hidden/secret.md', 'Hidden [[plants]].');
  put('outside.md', 'Out [[plants]].', dir);
  symlinkSync(path.join(dir, 'outside.md'), path.join(root, 'leak.md'));
  files = new Files(root);
  back = new Backlinks(files);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('backlinks', () => {
  it('finds the notes that link by file name, by title and by relative link', async () => {
    expect(await back.to('garden/plants.md')).toEqual([
      { path: 'index.md', title: 'Home' },
      { path: 'garden/Soil.md', title: 'Soil' },
    ]);
    expect(await back.to('garden/Soil.md')).toEqual([{ path: 'index.md', title: 'Home' }]);
    expect(await back.to('index.md')).toEqual([{ path: 'garden/plants.md', title: 'Green things' }]);
  });

  it('never reads hidden notes or notes behind a link out', async () => {
    const paths = (await back.to('garden/plants.md')).map((b) => b.path);
    expect(paths.some((p) => p.includes('hidden') || p.includes('leak'))).toBe(false);
  });

  it('answers the same call again without reading, and reads again only the note that changed', async () => {
    const text = vi.spyOn(files, 'text');
    await back.to('garden/plants.md');
    await back.to('garden/Soil.md');
    expect(text).toHaveBeenCalledTimes(0); // the links of every note are kept
    // a note is added on disk; the list of notes is cached for a few seconds, so look past that
    put('zeta.md', 'Now [[Soil]] too.\n');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    const out = await back.to('garden/Soil.md');
    now.mockRestore();
    expect(out.map((b) => b.path)).toEqual(['index.md', 'zeta.md']);
    expect(text.mock.calls.map((c) => c[0])).toEqual(['zeta.md']); // only the new note was read
    text.mockRestore();
  });
});
