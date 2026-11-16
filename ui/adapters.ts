// What the app needs from its surroundings, kept small so another shell can supply its own:
//   Source    where notes come from: a folder the user opened (PWA), the plugin's tools (a host),
//             or files held in memory (the sample, tests). A desktop or mobile shell adds its own.
//   Settings  where the reading aids' settings are kept: localStorage, or a host's tool.
//   Host      what the surroundings do for a link: open a web page, hand a note to the host.
// The AI adapter does not exist yet (v0: none).
import { byName, isNote, neighbours, resolveAll } from '../core/links.ts';
import { DEFAULTS, normalize } from '../core/settings.ts';
import type { ReaderSettings } from '../core/settings.ts';

export interface NoteDoc {
  path: string;
  name: string;
  /** The whole file, front matter included. */
  text: string;
  size: number;
  mtime: number;
  prev: string | null;
  next: string | null;
  /** Where each link of the note points: `[[target]]` or the relative href → note path, or null. */
  resolved: Record<string, string | null>;
}
export interface FolderEntry { name: string; path: string }
export interface NoteEntry extends FolderEntry { size: number; mtime: number }
export interface Listing { dir: string; folders: FolderEntry[]; files: NoteEntry[]; truncated?: boolean }

export interface Source {
  /** A short name for the folder or place the notes are in. */
  label: string;
  /** The notes can change while the page lives (a host's files): the reader reads a changed note again. */
  live?: boolean;
  read(path: string): Promise<NoteDoc>;
  list(dir: string): Promise<Listing>;
}

export interface SettingsAdapter {
  load(): Promise<ReaderSettings>;
  save(settings: ReaderSettings): Promise<void>;
}

export interface HostAdapter {
  openWeb(url: string): void;
  /** Hand a note to the host to open (zenbot); true when it took it, false to open it here. */
  openNote?(path: string): Promise<boolean>;
}

export interface Env { source: Source | null; settings: SettingsAdapter; host: HostAdapter; standalone: boolean }

// ---- a source over a set of files already known ----

export interface Held { size: number; mtime: number; text(): Promise<string> }

const SKIPPED = new Set(['node_modules']);
/** Whether a relative path belongs in the reader: a note, with no dot or `node_modules` folder above it. */
export const wanted = (path: string): boolean => {
  const segs = path.split('/');
  return isNote(path) && !segs.some((s, i) => (i < segs.length - 1 ? s.startsWith('.') || SKIPPED.has(s) : s.startsWith('.')));
};

/** A Source over `held`: relative path → file. Folders are read off the paths. */
export function indexSource(label: string, held: Map<string, Held>): Source {
  const paths = [...held.keys()].filter(wanted).sort(byName);
  const set = new Set(paths);
  return {
    label,
    async list(dir) {
      const prefix = dir ? `${dir}/` : '';
      const folders = new Map<string, FolderEntry>();
      const files: NoteEntry[] = [];
      for (const p of paths) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i < 0) {
          const h = held.get(p)!;
          files.push({ name: rest, path: p, size: h.size, mtime: h.mtime });
        } else if (!folders.has(rest.slice(0, i))) folders.set(rest.slice(0, i), { name: rest.slice(0, i), path: prefix + rest.slice(0, i) });
      }
      if (dir && !files.length && !folders.size && !paths.some((p) => p.startsWith(prefix))) throw new Error(`Not found: ${dir}`);
      return { dir, folders: [...folders.values()], files };
    },
    async read(path) {
      const h = set.has(path) ? held.get(path) : undefined;
      if (!h) throw new Error(`Not found: ${path}`);
      const text = (await h.text()).replace(/^﻿/, '');
      const body = text.replace(/\r\n?/g, '\n');
      return { path, name: path.split('/').pop()!, text, size: h.size, mtime: h.mtime, ...neighbours(path, paths), resolved: resolveAll(path, body, paths) };
    },
  };
}

/** Notes held as text, by relative path. */
export function memorySource(label: string, notes: Record<string, string>): Source {
  const held = new Map<string, Held>();
  const now = Date.now();
  for (const [p, t] of Object.entries(notes)) held.set(p, { size: t.length, mtime: now, text: async () => t });
  return indexSource(label, held);
}

/** A Source over the files of `<input type=file webkitdirectory>` or multiple files. With a folder, its name is the root. */
export function fileListSource(list: ArrayLike<File>): Source {
  const held = new Map<string, Held>();
  let label = '';
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const segs = rel.split('/');
    if (segs.length > 1) {
      label ||= segs[0];
      segs.shift();
    }
    held.set(segs.join('/'), { size: f.size, mtime: f.lastModified, text: () => f.text() });
  }
  return indexSource(label || 'Files', held);
}

// ---- the File System Access API (Chromium browsers) ----

interface FsHandle { kind: 'file' | 'directory'; name: string }
interface FsFile extends FsHandle { kind: 'file'; getFile(): Promise<File> }
interface FsDir extends FsHandle { kind: 'directory'; values(): AsyncIterable<FsFile | FsDir> }

export const canPickFolder = (): boolean => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** Asks the user for a folder and reads its notes (at most `limit`, to a depth of 12). Null when cancelled. */
export async function pickFolder(limit = 5000): Promise<Source | null> {
  let root: FsDir;
  try {
    root = await (globalThis as unknown as { showDirectoryPicker(o?: object): Promise<FsDir> }).showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
  const held = new Map<string, Held>();
  const walk = async (dir: FsDir, prefix: string, depth: number): Promise<void> => {
    for await (const h of dir.values()) {
      if (held.size >= limit) return;
      if (h.name.startsWith('.') || SKIPPED.has(h.name)) continue;
      const rel = prefix + h.name;
      if (h.kind === 'directory') {
        if (depth < 12) await walk(h, `${rel}/`, depth + 1);
      } else if (isNote(h.name)) {
        const file = await h.getFile();
        held.set(rel, { size: file.size, mtime: file.lastModified, text: async () => (await h.getFile()).text() });
      }
    }
  };
  await walk(root, '', 0);
  return indexSource(root.name, held);
}

// ---- settings ----

/** localStorage under one key; an unavailable or full store (private mode, a sandboxed frame) falls back to memory. */
export function localSettings(key = 'zenread.settings'): SettingsAdapter {
  let memory: ReaderSettings = { ...DEFAULTS };
  return {
    async load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw) memory = normalize(JSON.parse(raw));
      } catch { /* unreadable: keep what is held */ }
      return memory;
    },
    async save(s) {
      memory = s;
      try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* private mode / quota / sandbox */ }
    },
  };
}
