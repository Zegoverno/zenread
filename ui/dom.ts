// The reader's DOM work: the changelog split, words for play and the reading time, the blocks focus
// lights and the visual lines inside one, bionic reading. Pure DOM, no framework.

/** Takes the changelog (a top-level heading naming it, any level, and all after it) out of `md`
 *  into a new element; null when there is none. */
export function takeChangelog(md: HTMLElement): HTMLElement | null {
  const kids = [...md.children];
  const at = kids.findIndex((e) => /^H[1-6]$/.test(e.tagName) && /\bchangelog\b/i.test(e.textContent ?? ''));
  if (at < 0) return null;
  const log = document.createElement('div');
  log.className = 'md';
  for (const e of kids.slice(at + 1)) log.append(e);
  kids[at].remove();
  return log;
}

const SKIP = 'code, pre, .md-math';

/** Wraps each word (anything with a letter or digit) of the text under `root` in `span.w`, for
 *  play and the reading time; code and math are left alone. */
export function wrapWords(root: HTMLElement): HTMLElement[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const t of nodes) {
    const parts = t.data.split(/(\S+)/);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      if (!p) return;
      if (i % 2 === 0 || !/[\p{L}\p{N}]/u.test(p)) return void frag.append(p);
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = p;
      frag.append(s);
    });
    t.replaceWith(frag);
  }
  return [...root.querySelectorAll<HTMLElement>('span.w')];
}

const LEAF = 'p, h1, h2, h3, h4, h5, h6, pre, table, .md-html, .md-callout-title';

/** The blocks focus lights: paragraphs (with any math in them), headings, code, tables, display
 *  math on its own, list items with no blocks inside. Outermost of each, in order. */
export function units(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(`${LEAF}, .md-display, li`)];
  return all.filter((e) => {
    if ((e.textContent ?? '').trim() === '' && !e.querySelector('img')) return false;
    if (e.parentElement?.closest(LEAF)) return false;
    if (e.tagName === 'LI') return !e.querySelector(`${LEAF}, ul, ol, .md-display`);
    return true;
  });
}

/** A block's visual lines, `[top, bottom]` in px from the block's top, from the boxes of its text. */
export function lines(unit: HTMLElement): [number, number][] {
  const r = document.createRange();
  r.selectNodeContents(unit);
  const base = unit.getBoundingClientRect().top;
  const rects = [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0).sort((a, b) => a.top - b.top);
  const out: [number, number][] = [];
  for (const b of rects) {
    const mid = (b.top + b.bottom) / 2 - base;
    const last = out.at(-1);
    if (last && mid >= last[0] && mid <= last[1]) {
      last[0] = Math.min(last[0], b.top - base);
      last[1] = Math.max(last[1], b.bottom - base);
    } else if (last && b.top - base < last[1] - 2) {
      // a box mostly inside the line before (math, a bold run): the same line
      last[1] = Math.max(last[1], b.bottom - base);
    } else out.push([b.top - base, b.bottom - base]);
  }
  // Lines touch: each runs to the next one's top so the band covers the leading.
  for (let i = 0; i + 1 < out.length; i++) out[i][1] = Math.max(out[i][1], out[i + 1][0]);
  return out;
}

/** Bold on the first part of each word (bionic reading), in the text nodes under `root`. */
export function bionic(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, .md-math, .md-bionic') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const t of nodes) {
    const parts = t.data.split(/(\p{L}[\p{L}\p{M}'’-]*)/u);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      if (i % 2 === 0) return p && frag.append(p);
      const k = p.length <= 3 ? 1 : Math.ceil(p.length * 0.45);
      const b = bold();
      b.textContent = p.slice(0, k);
      frag.append(b, p.slice(k));
    });
    t.replaceWith(frag);
  }
}

function bold(): HTMLElement {
  const b = document.createElement('b');
  b.className = 'md-bionic';
  return b;
}
