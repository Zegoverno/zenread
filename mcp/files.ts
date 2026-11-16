// The files a tool may touch: everything under one root (ZEN_PLUGIN_FILES), read-only.
//
// Every path a tool takes is relative to the root. A path is refused when it is absolute (a
// leading `/` or `\`, a drive letter), has a NUL or a backslash, climbs with `..`, or has a segment
// starting with a dot (`.git`, `.obsidian`, `.hidden.md`). After that the real path (symlinks
// followed) must still lie inside the real root, so a link pointing out is never read or listed.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { byName, dirOf, isNote, neighbours, normalizePath } from '../core/links.ts';

/** The biggest note read, in bytes. */
export const MAX_BYTES = 2 * 1024 * 1024;
/** The most entries listed in one folder, and notes indexed for links. */
export const MAX_ENTRIES = 2000;
export const MAX_INDEX = 5000;

export class FileError extends Error {}

export interface Entry { name: string; path: string }
export interface FileEntry extends Entry { size: number; mtime: number }
export interface Listing { dir: string; folders: Entry[]; files: FileEntry[]; truncated: boolean }
export interface NoteFile { path: string; text: string; size: number; mtime: number; prev: string | null; next: string | null }

const hidden = (name: string) => name.startsWith('.');
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export class Files {
  readonly root: string;
  private real: Promise<string>;
  private notes: { at: number; list: string[] } | null = null;

  constructor(root: string) {
    this.root = root;
    if (!path.isAbsolute(root)) throw new FileError('ZEN_PLUGIN_FILES must be an absolute path.');
    this.real = realpath(root);
  }

  /** The clean relative path (`a/b.md`; '' for the root) or an error saying why not. Pure: checks the text only. */
  static clean(rel: unknown): string {
    if (typeof rel !== 'string') throw new FileError('A path must be text.');
    if (rel.length > 1000) throw new FileError('That path is too long.');
    if (rel.includes('\0')) throw new FileError('That path is not valid.');
    if (rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('~')) throw new FileError('Paths are relative to the files folder: no absolute paths.');
    if (rel.includes('\\')) throw new FileError('Use / between folders.');
    const segs = rel.split('/').filter((s) => s !== '' && s !== '.');
    if (segs.includes('..')) throw new FileError('A path may not contain "..".');
    if (segs.some(hidden)) throw new FileError('Hidden files and folders (starting with a dot) are not available.');
    return normalizePath(segs.join('/')) ?? '';
  }

  /** The absolute path of a clean relative path, only if its real location is inside the root. */
  private async inside(rel: string): Promise<string> {
    const root = await this.real;
    const abs = path.join(root, rel);
    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      throw new FileError(`Not found: ${rel || '(root)'}`);
    }
    if (real !== root && !real.startsWith(root + path.sep)) throw new FileError('That path leads outside the files folder.');
    // Hidden parts reached only through a link would slip past `clean`; check the real tail too.
    if (path.relative(root, real).split(path.sep).some(hidden)) throw new FileError('Hidden files and folders (starting with a dot) are not available.');
    return real;
  }

  async list(dirRel = ''): Promise<Listing> {
    const dir = Files.clean(dirRel);
    const abs = await this.inside(dir);
    if (!(await stat(abs)).isDirectory()) throw new FileError(`Not a folder: ${dir}`);
    const folders: Entry[] = [];
    const files: FileEntry[] = [];
    let truncated = false;
    for (const name of (await readdir(abs)).sort(byName)) {
      if (hidden(name)) continue;
      if (folders.length + files.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const rel = join(dir, name);
      let real: string;
      try {
        real = await this.inside(rel);
      } catch {
        continue; // a link out, or broken: not listed
      }
      const s = await stat(real);
      if (s.isDirectory()) folders.push({ name, path: rel });
      else if (s.isFile() && isNote(name)) files.push({ name, path: rel, size: s.size, mtime: Math.floor(s.mtimeMs) });
    }
    return { dir, folders, files, truncated };
  }

  /** The note and the notes before and after it in its folder. */
  async read(rel: unknown): Promise<NoteFile> {
    const p = Files.clean(rel);
    if (!p || !isNote(p)) throw new FileError('The reader opens Markdown notes (.md): give a path to one.');
    const abs = await this.inside(p);
    const s = await stat(abs);
    if (!s.isFile()) throw new FileError(`Not a file: ${p}`);
    if (s.size > MAX_BYTES) throw new FileError(`${p} is too big to read here (${Math.round(s.size / 1024)} KB; the limit is ${MAX_BYTES / 1024} KB).`);
    const text = (await readFile(abs, 'utf8')).replace(/^﻿/, '');
    const peers = (await this.list(dirOf(p))).files.map((f) => f.path);
    return { path: p, text, size: s.size, mtime: Math.floor(s.mtimeMs), ...neighbours(p, peers) };
  }

  /** Every note under the root (breadth first, capped), for resolving `[[wiki links]]`. Cached for a few seconds. */
  async index(): Promise<string[]> {
    if (this.notes && Date.now() - this.notes.at < 5000) return this.notes.list;
    const out: string[] = [];
    const queue = [''];
    while (queue.length && out.length < MAX_INDEX) {
      const l = await this.list(queue.shift()!).catch(() => null);
      if (!l) continue;
      out.push(...l.files.map((f) => f.path));
      queue.push(...l.folders.map((f) => f.path));
    }
    this.notes = { at: Date.now(), list: out.slice(0, MAX_INDEX) };
    return this.notes.list;
  }
}

