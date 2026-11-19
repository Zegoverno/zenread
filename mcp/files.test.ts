import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileError, Files, MAX_BYTES } from './files.ts';

let dir: string, root: string, outside: string, files: Files;
const put = (rel: string, text = `# ${rel}\n`, base = root) => {
  mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  writeFileSync(path.join(base, rel), text);
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zenread-files-'));
  root = path.join(dir, 'vault');
  outside = path.join(dir, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  put('index.md');
  put('notes/a.md');
  put('notes/b.md');
  put('notes/c10.md');
  put('notes/c2.md');
  put('notes/readme.txt', 'plain');
  put('notes/deep/x.md');
  put('.hidden/secret.md');
  put('.dot.md');
  put('secret.md', 'top secret', outside);
  put('shared/y.md', 'outside note', outside);
  symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'notes/leak.md')); // a file link out
  symlinkSync(path.join(outside, 'shared'), path.join(root, 'linked')); // a folder link out
  symlinkSync(path.join(root, 'notes/a.md'), path.join(root, 'notes/alias.md')); // a link that stays inside
  symlinkSync(path.join(root, '.hidden'), path.join(root, 'sneaky')); // a link to a dot folder, inside the root
  symlinkSync(path.join(dir, 'nowhere.md'), path.join(root, 'notes/broken.md'));
  files = new Files(root);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const refuses = async (p: unknown, why?: RegExp) => {
  const e = await files.read(p).then(() => null, (x) => x);
  expect(e, String(p)).toBeInstanceOf(FileError);
  if (why) expect(e.message).toMatch(why);
};

describe('reading', () => {
  it('reads a note with its neighbours in natural order', async () => {
    const n = await files.read('notes/c2.md');
    expect(n.text).toBe('# notes/c2.md\n');
    expect(n.prev).toBe('notes/b.md');
    expect(n.next).toBe('notes/c10.md');
    expect((await files.read('index.md')).next).toBeNull();
    expect(n).toMatchObject({ at: 4, count: 5 }); // a, alias, b, c2, c10 (the link out and the broken link are not listed)
    expect(await files.read('notes/a.md')).toMatchObject({ at: 1, count: 5, prev: null });
  });
  it('lists a folder: notes and folders only, no dot entries, no links out', async () => {
    const root = await files.list();
    expect(root.folders.map((f) => f.path)).toEqual(['notes']);
    expect(root.files.map((f) => f.path)).toEqual(['index.md']);
    const n = await files.list('notes');
    expect(n.files.map((f) => f.path)).toEqual(['notes/a.md', 'notes/alias.md', 'notes/b.md', 'notes/c2.md', 'notes/c10.md']);
    expect(n.folders.map((f) => f.path)).toEqual(['notes/deep']);
    expect((await files.list('./notes/')).dir).toBe('notes');
  });
  it('indexes every note, for links', async () => {
    const all = await files.index();
    expect(all).toContain('notes/deep/x.md');
    expect(all).not.toContain('linked/y.md');
    expect(all.some((p) => p.includes('hidden') || p.includes('leak'))).toBe(false);
  });
});

describe('safety', () => {
  it('refuses traversal', async () => {
    for (const p of ['../outside/secret.md', 'notes/../../outside/secret.md', '..', 'notes/..', '../vault/index.md', 'a/../index.md'])
      await refuses(p, /\.\./);
  });
  it('refuses absolute paths, drives, home and backslashes', async () => {
    await refuses(path.join(root, 'index.md'), /absolute/);
    await refuses('/etc/passwd.md', /absolute/);
    await refuses('C:/x.md', /absolute/);
    await refuses('~/x.md', /absolute/);
    await refuses('\\windows\\x.md', /absolute/);
    await refuses('notes\\a.md', /Use \//);
  });
  it('refuses odd input', async () => {
    await refuses('notes/a.md\0.png');
    await refuses(42);
    await refuses(undefined);
    await refuses('x'.repeat(1001) + '.md', /too long/);
  });
  it('refuses dot files and folders', async () => {
    await refuses('.dot.md', /Hidden/);
    await refuses('.hidden/secret.md', /Hidden/);
    await refuses('notes/.git/x.md', /Hidden/);
    await expect(files.list('.hidden')).rejects.toThrow(/Hidden/);
    await expect(files.list('.')).resolves.toBeTruthy(); // "." is the root, not a dot folder
  });
  it('refuses a symlink that leaves the root', async () => {
    await refuses('notes/leak.md', /outside/);
    await refuses('linked/y.md', /outside/);
    await expect(files.list('linked')).rejects.toThrow(/outside/);
  });
  it('refuses a link inside the root that reaches a dot folder', async () => {
    await refuses('sneaky/secret.md', /Hidden/);
  });
  it('reads a symlink that stays inside', async () => {
    expect((await files.read('notes/alias.md')).text).toBe('# notes/a.md\n');
  });
  it('refuses what is not a note, is missing, a folder or too big', async () => {
    await refuses('notes/readme.txt', /Markdown/);
    await refuses('notes', /Markdown/);
    await refuses('notes/missing.md', /Not found/);
    await refuses('notes/broken.md', /Not found/);
    await refuses('', /Markdown/);
    put('big.md', 'x'.repeat(MAX_BYTES + 1));
    await refuses('big.md', /too big/);
  });
  it('requires an absolute root', () => {
    expect(() => new Files('relative/dir')).toThrow(FileError);
  });
});
