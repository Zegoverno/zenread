// "Linked from": the notes under the root that link to a note, found by reading them all once.
//
// Each note's links are kept by path, size and time, so a call reads only what changed since the last
// one; the list of notes is cached a few seconds by Files.scan, and a call on the same scan for the
// same note gives the same answer without work. Reads run a few at a time.
import { backlinksTo, noteTitle, refsOf } from '../core/backlinks.ts';
import type { NoteRefs } from '../core/backlinks.ts';
import type { FileEntry, Files } from './files.ts';

/** The most backlinks returned. */
export const MAX_BACKLINKS = 200;
const PARALLEL = 8;

export interface Backlink { path: string; title: string }

export class Backlinks {
  private held = new Map<string, { size: number; mtime: number; note: NoteRefs }>();
  private last: { scan: readonly FileEntry[]; target: string; out: Backlink[] } | null = null;

  private files: Files;

  constructor(files: Files) {
    this.files = files;
  }

  /** The notes that link to `target` (a clean path of a note that exists), by title. */
  async to(target: string): Promise<Backlink[]> {
    const scan = await this.files.scan();
    if (this.last && this.last.scan === scan && this.last.target === target) return this.last.out;
    const live = new Set(scan.map((f) => f.path));
    for (const p of this.held.keys()) if (!live.has(p)) this.held.delete(p);

    const todo = scan.filter((f) => { const h = this.held.get(f.path); return !h || h.size !== f.size || h.mtime !== f.mtime; });
    let next = 0;
    const work = async () => {
      for (let f = todo[next++]; f; f = todo[next++]) {
        try {
          const t = await this.files.text(f.path);
          this.held.set(f.path, { size: t.size, mtime: t.mtime, note: refsOf(t.path, t.text) });
        } catch { /* unreadable or too big: it links to nothing */ this.held.delete(f.path); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, work));

    const all = scan.flatMap((f) => { const h = this.held.get(f.path); return h ? [h.note] : []; });
    const self = this.held.get(target)?.note;
    const out = backlinksTo(target, self?.title ?? noteTitle(target, ''), all).slice(0, MAX_BACKLINKS);
    this.last = { scan, target, out };
    return out;
  }
}
