// Which notes link to a note, pure: a note's title, and whether one of its links points at a target.
// The server (mcp/backlinks.ts) reads the notes and caches; this is only the rule.
import { collectRefs, resolveRelative, resolveWiki } from './links.ts';
import { properties, splitFront } from './text.ts';

const stem = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');

/** What a note is called: its `title` property, else its first `#` heading, else its file name. */
export function noteTitle(path: string, text: string): string {
  const { front, body } = splitFront(text);
  const fromFront = front ? properties(front).find(([k]) => k.toLowerCase() === 'title')?.[1] : '';
  if (fromFront) return fromFront;
  const h = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, ''));
  return h?.[1].trim() || stem(path);
}

/** A link's wiki target as a bare name: no alias, no anchor, no `.md`, lower case. */
const wikiName = (ref: string) => ref.split('|')[0].split('#')[0].trim().replace(/\\/g, '/').replace(/\.(md|markdown)$/i, '').toLowerCase();

/** What a note's links are, kept so a note is read once: `collectRefs` of its text, and its title. */
export interface NoteRefs { path: string; title: string; refs: string[] }

export const refsOf = (path: string, text: string): NoteRefs => ({ path, title: noteTitle(path, text), refs: collectRefs(splitFront(text).body) });

/** Whether a link of the note `from` points at `target`: a relative `.md` link to it, or a `[[wiki link]]`
 *  that resolves to it among `files` or is written as the target's title. */
export function pointsAt(target: string, targetTitle: string, from: string, refs: readonly string[], files: readonly string[]): boolean {
  const name = stem(target).toLowerCase();
  const title = targetTitle.trim().toLowerCase();
  for (const ref of refs) {
    if (ref.startsWith('[[')) {
      const w = wikiName(ref.slice(2, -2));
      if (!w) continue;
      const at = ref.slice(2, -2);
      // A link written as the title counts unless the file name already sends it to another note.
      if (w === title) {
        const r = resolveWiki(at, from, files);
        if (r === null || r === target) return true;
        continue;
      }
      // A wiki link resolves to a note whose name is its last segment: skip the search for any other.
      if (w.slice(w.lastIndexOf('/') + 1) !== name) continue;
      if (resolveWiki(at, from, files) === target) return true;
    } else if (resolveRelative(from, ref) === target) return true;
  }
  return false;
}

/** The notes of `all` that link to `target`, by title in natural order (the target itself left out). */
export function backlinksTo(target: string, targetTitle: string, all: readonly NoteRefs[]): { path: string; title: string }[] {
  const files = all.map((n) => n.path);
  return all
    .filter((n) => n.path !== target && pointsAt(target, targetTitle, n.path, n.refs, files))
    .map((n) => ({ path: n.path, title: n.title }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }) || (a.path < b.path ? -1 : 1));
}
