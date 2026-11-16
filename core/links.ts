// Note paths and links, pure: where a link in a note points, and the files next to a note. All
// paths are relative to a root, with `/` as separator, never absolute and never leaving the root.

export const isNote = (path: string): boolean => /\.(md|markdown)$/i.test(path);

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stem = (p: string) => base(p).replace(/\.(md|markdown)$/i, '');

/** `a/./b//c` and `..` folded; null when it climbs out of the root. */
export function normalizePath(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The anchor of a link (`note.md#Heading` → `Heading`), decoded; '' when none. */
export function anchorOf(ref: string): string {
  const i = ref.indexOf('#');
  if (i < 0) return '';
  try {
    return decodeURIComponent(ref.slice(i + 1));
  } catch {
    return ref.slice(i + 1);
  }
}

/** A Markdown link's target (`../b/note.md#x`) as a note path, from the note it is in; null when it is
 *  not a relative link to a note or leaves the root. A leading `/` means the root. */
export function resolveRelative(from: string, href: string): string | null {
  if (!href || SCHEME.test(href) || href.startsWith('#') || href.startsWith('//')) return null;
  let target = href.replace(/[#?].*$/s, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep it as written */
  }
  const joined = target.startsWith('/') ? target : `${dirOf(from)}/${target}`;
  const norm = normalizePath(joined);
  return norm && isNote(norm) ? norm : null;
}

/** A `[[wiki link]]` among `files`: a path with folders matches from the root, then from the note's
 *  folder, then as the tail of a path; a bare name matches any note of that name, nearest first
 *  (same folder, then fewest folders, then alphabetical). Case is ignored. */
export function resolveWiki(ref: string, from: string, files: readonly string[]): string | null {
  const target = ref.split('|')[0].split('#')[0].trim().replace(/\\/g, '/').replace(/\.(md|markdown)$/i, '').replace(/^\/+/, '');
  if (!target) return null;
  const want = target.toLowerCase();
  const key = (f: string) => f.replace(/\.(md|markdown)$/i, '').toLowerCase();
  if (target.includes('/')) {
    const rel = normalizePath(`${dirOf(from)}/${target}`)?.toLowerCase();
    for (const at of [want, rel]) {
      const hit = files.find((f) => key(f) === at);
      if (hit) return hit;
    }
    const tail = files.filter((f) => key(f).endsWith(`/${want}`)).sort((a, b) => a.length - b.length || a.localeCompare(b));
    return tail[0] ?? null;
  }
  const same = files.filter((f) => stem(f).toLowerCase() === want);
  if (!same.length) return null;
  const here = dirOf(from);
  const depth = (f: string) => f.split('/').length;
  same.sort((a, b) => Number(dirOf(a) !== here) - Number(dirOf(b) !== here) || depth(a) - depth(b) || a.localeCompare(b));
  return same[0];
}

/** The link targets in a note, as the page reads them, without repeats and skipping code: wiki links as
 *  `[[target]]` (the part before `|`), relative Markdown links as their href. */
export function collectRefs(markdown: string): string[] {
  const text = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]\n]{1,300})\]\]/g)) {
    const t = m[1].split('|')[0].trim();
    if (t) seen.add(wikiKey(t));
  }
  for (const m of text.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    const href = m[1].replace(/^<|>$/g, '');
    if (href && !SCHEME.test(href) && !href.startsWith('#') && !href.startsWith('//')) seen.add(href);
  }
  return [...seen];
}

/** The key a wiki link target has in `resolveAll`'s result. */
export const wikiKey = (target: string): string => `[[${target}]]`;

/** Natural, case-insensitive order of file names: `note2` before `note10`. */
export const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/** The notes in a folder, in reading order, and the ones before and after `path`. */
export function neighbours(path: string, files: readonly string[]): { prev: string | null; next: string | null } {
  const dir = dirOf(path);
  const peers = files.filter((f) => isNote(f) && dirOf(f) === dir).sort((a, b) => byName(base(a), base(b)));
  const i = peers.indexOf(path);
  return i < 0 ? { prev: null, next: null } : { prev: peers[i - 1] ?? null, next: peers[i + 1] ?? null };
}

/** Resolves every link of `markdown` against `files`: each `collectRefs` key to a note path, or null. */
export function resolveAll(from: string, markdown: string, files: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const set = new Set(files);
  for (const ref of collectRefs(markdown)) {
    if (ref.startsWith('[[')) out[ref] = resolveWiki(ref.slice(2, -2), from, files);
    else {
      const rel = resolveRelative(from, ref);
      out[ref] = rel && set.has(rel) ? rel : null;
    }
  }
  return out;
}
