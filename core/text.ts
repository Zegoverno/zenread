// The reader's text work that needs no DOM: front matter, properties, the note's web link, play's
// timing, heading slugs. (The DOM side, which wraps words and finds blocks, is ui/dom.ts.)

/** The front matter block (`---` … `---`) taken off the top of a note. CRLF is read as LF. */
export function splitFront(text: string): { front: string | null; body: string } {
  const src = text.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/.exec(src);
  return m ? { front: m[1], body: src.slice(m[0].length) } : { front: null, body: src };
}

/** Front matter lines as properties: `[a, b]` and `- a` lists as `a · b`, quotes off, empty ones left out. */
export function properties(front: string): [string, string][] {
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '');
  const props: [string, string[]][] = [];
  for (const l of front.split('\n')) {
    const item = /^[ -]/.test(l) ? /^\s*- (.*)$/.exec(l) : null;
    if (item) {
      props.at(-1)?.[1].push(unquote(item[1]));
      continue;
    }
    const i = l.indexOf(':');
    if (i <= 0 || l.startsWith(' ')) continue;
    const v = l.slice(i + 1).trim();
    let vs: string[];
    if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) vs = v.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else vs = v ? [unquote(v)] : [];
    props.push([l.slice(0, i).trim(), vs]);
  }
  return props.filter(([, vs]) => vs.length).map(([k, vs]) => [k, vs.join(' · ')]);
}

/** The note's web link: the first http(s) value among the properties, `link`, `url` and `source` first. */
export function sourceLink(props: [string, string][]): string | null {
  const web = (v: string) => /^https?:\/\/\S+$/.exec(v.split(' · ')[0].trim())?.[0];
  const pref = ['link', 'url', 'source'];
  const rank = (k: string) => pref.indexOf(k.toLowerCase()) + 1 || 99;
  const ranked = [...props].sort(([a], [b]) => rank(a) - rank(b));
  for (const [, v] of ranked) {
    const u = web(v);
    if (u) return u;
  }
  return null;
}

/** The letter a word is recognized by (Spritz's optimal recognition point). */
export function orp(word: string): number {
  const n = [...word].length;
  return n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
}

/** How long a word stays, in ms: with pauses, longer at the end of a sentence or clause and for long words. */
export function dwell(word: string, wpm: number, pauses: boolean): number {
  const base = 60_000 / Math.max(1, wpm);
  if (!pauses) return base;
  let f = /[.!?:]$/.test(word) ? 2.2 : /[,;)]$/.test(word) ? 1.5 : 1;
  if ([...word].length > 8) f += 0.3;
  return base * f;
}

/** A heading as an anchor: lower case, punctuation off, spaces as hyphens. */
export const slug = (s: string): string => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

/** Words in a text (anything with a letter or digit), for a first estimate of the reading time. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
