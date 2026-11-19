<script lang="ts">
  // The reader: prose laid out for reading, the front matter folded to a line, the changelog in its own
  // footer; reading aids (width, spacing, bionic, focus, dimming); links followed with a way back; and
  // play, one word at a time. The notes come from a Source (a folder, a host's tools, memory) and the
  // settings from the store, so the same component runs as the PWA and as an MCP App.
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { Backlink, Env, NoteDoc } from './adapters.ts';
  import type { Store } from './store.svelte.ts';
  import { render } from './md.ts';
  import { bionic, takeChangelog, units, lines, wrapWords } from './dom.ts';
  import { anchorOf, dirOf, resolveRelative, wikiKey } from '../core/links.ts';
  import { DIMS, WPM, keep, nextDim, nextFocus, widen as widthStep } from '../core/settings.ts';
  import type { ReaderSettings } from '../core/settings.ts';
  import { chips, dwell, orp, properties, slug, sourceLink } from '../core/text.ts';
  import { taskId } from '../core/tasks.ts';
  import { zen } from './zen.svelte.ts';

  let { store, env }: { store: Store; env: Env } = $props();
  const path = $derived(store.path ?? '');
  const set = $derived(store.settings);

  let doc = $state<NoteDoc | null>(null);
  let error = $state('');
  let loading = $state(true);
  /** The notes that link here ("Linked from"), once the source has said; empty when it cannot. */
  let linked = $state<Backlink[]>([]);

  let scroller = $state<HTMLDivElement>();
  let host = $state<HTMLDivElement>();
  let logScroller = $state<HTMLDivElement>();
  let logHost = $state<HTMLDivElement>();

  let fm = $state<[string, string][]>([]);
  /** In zenbot: the note's title (its first heading, else the title property, else the file name). */
  let title = $state('');
  let propsOpen = $state(false);
  let hasLog = $state(false);
  let showLog = $state(false);
  let logHint = $state('');
  let pct = $state(0);
  let wordsLeft = $state(0);
  let nWords = $state(0);
  let linkSel = $state(-1);
  let focusAt = $state(-1);
  let lineAt = $state(0);
  let mark = $state<{ top: number; height: number } | null>(null);
  let play = $state<{ at: number; playing: boolean } | null>(null);

  // The rendered document's parts (rebuilt with it, not reactive).
  let words: HTMLElement[] = [];
  let tops: number[] | null = null;
  let us: HTMLElement[] = [];
  let links: HTMLAnchorElement[] = [];
  let logUnits: HTMLElement[] = [];

  const name = $derived(path.split('/').pop() ?? path);
  const folder = $derived(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const minutes = $derived(Math.ceil(wordsLeft / WPM));
  const k = $derived(keep(set.dim));
  const focusing = $derived(set.focus !== 'off' && !play);
  const canBack = $derived(store.back.length > 0);
  // In zenbot the host draws the pane's title bar and close ×; the reader keeps only its own tools,
  // behind "Aa" (the reading aids), so a phone's pane stays calm.
  const inZen = $derived(zen.active);
  let aids = $state(false);
  const zchips = $derived(chips(fm));

  // ---- the folder's other notes (previous / next, from the source) ----

  const hasPrev = $derived(!!doc?.prev);
  const hasNext = $derived(!!doc?.next);
  async function sibling(d: 1 | -1) {
    const to = d > 0 ? doc?.next : doc?.prev;
    if (!to) return;
    // In zenbot the host's title bar names the file: let it open the neighbour, which it then tells us.
    try {
      if (env.host.openNote && (await env.host.openNote(to))) return;
    } catch { /* the host could not: open it here */ }
    store.open(to, { fresh: true });
  }

  // ---- loading ----

  let seq = 0;
  let pendingAnchor = '';
  $effect(() => {
    const p = store.path;
    const a = store.anchor;
    void store.nonce;
    if (!p) return;
    untrack(() => {
      stop();
      pendingAnchor = a;
      void load(p);
    });
  });

  /** `again`: the same note read anew after a change on disk; the page stays where it was. */
  async function load(p: string, again = false) {
    const n = ++seq;
    if (!again) loading = true;
    let d: NoteDoc;
    try {
      d = await store.source!.read(p);
    } catch (e) {
      if (n !== seq) return;
      loading = false;
      error = (e as Error).message;
      doc = null;
      return;
    }
    if (n !== seq) return;
    const at = again ? (scroller?.scrollTop ?? 0) : (store.scrolls.get(p) ?? 0);
    error = '';
    doc = d;
    loading = false;
    if (!again) linked = [];
    // After the note is shown: the scan for backlinks may take a moment and must not delay the text.
    store.source!.backlinks?.(p).then((l) => { if (n === seq) linked = l; }, () => { if (n === seq) linked = []; });
    if (!again) {
      linkSel = -1;
      focusAt = -1;
      showLog = false;
      propsOpen = false;
    }
    await tick();
    build();
    requestAnimationFrame(() => {
      if (!scroller) return;
      scroller.scrollTop = at;
      if (pendingAnchor && !again) jump(pendingAnchor);
      pendingAnchor = '';
      measure();
      if (focusing) pickFocus();
    });
  }

  /** Renders the file into the page: words wrapped, bionic when on. */
  function build() {
    if (!host || !logHost) return;
    const d = doc;
    words = [];
    us = [];
    links = [];
    logUnits = [];
    tops = null;
    fm = [];
    hasLog = false;
    if (!d) {
      host.replaceChildren();
      logHost.replaceChildren();
      return;
    }
    const r = render(d.text);
    const body = r.el;
    fm = r.front ? properties(r.front) : [];
    const first = body.firstElementChild;
    if (inZen && first?.tagName === 'H1' && (first.textContent ?? '').trim()) {
      title = first.textContent!.trim();
      first.remove();
    } else title = fm.find(([k]) => k.toLowerCase() === 'title')?.[1] || name.replace(/\.(md|markdown)$/i, '');
    const log = takeChangelog(body);
    words = wrapWords(body);
    nWords = words.length;
    if (set.bionic) {
      bionic(body);
      if (log) bionic(log);
    }
    host.replaceChildren(body);
    logHost.replaceChildren(...(log ? [log] : []));
    hasLog = !!log && (log.textContent ?? '').trim() !== '';
    if (!hasLog) showLog = false;
    // Tasks can be ticked where the host does it (zenbot); elsewhere the boxes stay as read-only marks.
    if (env.host.setTask) for (const box of body.querySelectorAll<HTMLInputElement>('li.md-task[data-line] > p > input[type=checkbox]')) box.disabled = false;
    us = units(body);
    us.forEach((u) => u.classList.add('u'));
    links = [...body.querySelectorAll('a')];
    for (const a of links) if (a.dataset.wiki !== undefined && d.resolved[wikiKey(a.dataset.wiki)] === null) a.classList.add('missing');
    logUnits = log ? units(log) : [];
    paintFocus();
    if (play) paintWord();
  }

  // A live source (a host's files): when the note changes on disk, read it again where it was.
  const poll = setInterval(async () => {
    const live = store.source?.live;
    if (!live || document.hidden || !doc || loading || play) return;
    const p = path;
    try {
      const entry = (await store.source!.list(dirOf(p))).files.find((f) => f.path === p);
      if (entry && doc && p === path && entry.mtime > doc.mtime) await load(p, true);
    } catch { /* the folder could not be listed: try again next time */ }
  }, 2000);
  onDestroy(() => {
    clearInterval(poll);
    clearTimeout(timer);
  });

  let ro: ResizeObserver | undefined;
  onMount(() => {
    ro = new ResizeObserver(() => {
      tops = null;
      measure();
      paintFocus();
      logStats();
    });
    if (host) ro.observe(host);
    if (scroller) ro.observe(scroller);
    return () => ro?.disconnect();
  });

  // ---- where the reader is ----

  /** Each word's top in the scroller's content (cached until the layout changes). */
  function wordTops(): number[] {
    if (tops || !scroller) return tops ?? [];
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    tops = words.map((w) => w.getBoundingClientRect().top - base);
    return tops;
  }
  /** The first word at or below `y` (scroller content px). */
  function wordAt(y: number): number {
    const t = wordTops();
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (t[m] < y) lo = m + 1;
      else hi = m;
    }
    return lo;
  }
  /** An element's top and bottom in the scroller's content. */
  function box(e: Element): { top: number; bottom: number } {
    const r = e.getBoundingClientRect();
    const base = scroller!.getBoundingClientRect().top - scroller!.scrollTop;
    return { top: r.top - base, bottom: r.bottom - base };
  }

  let raf = 0;
  function onScroll() {
    if (!scroller) return;
    store.scrolls.set(path, scroller.scrollTop);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      measure();
      if (focusing && !stepping) keepFocusInView();
      stepping = false;
    });
  }
  function measure() {
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    pct = max <= 1 ? 100 : Math.round((scroller.scrollTop / max) * 100);
    wordsLeft = words.length - wordAt(scroller.scrollTop - 2);
  }

  function scrollBy(px: number) {
    scroller?.scrollBy({ top: px });
  }
  const pageH = () => (scroller ? scroller.clientHeight * 0.9 : 400);
  const lineH = () => (scroller ? parseFloat(getComputedStyle(scroller).fontSize) * 1.8 : 30);

  /** Brings `y` (scroller content px) into view, at a third of the height, unless it already is. */
  function reveal(top: number, bottom = top + 20, margin = 0.15) {
    if (!scroller) return;
    const h = scroller.clientHeight;
    const s = scroller.scrollTop;
    if (top < s + h * margin || bottom > s + h * (1 - margin)) {
      stepping = true;
      scroller.scrollTop = Math.max(0, top - h / 3);
    }
  }

  // ---- settings ----

  function change(c: Partial<ReaderSettings>, label = true) {
    const rebuild = c.bionic !== undefined && c.bionic !== set.bionic;
    store.change(c, label);
    if (rebuild) {
      const at = scroller?.scrollTop ?? 0;
      build();
      requestAnimationFrame(() => scroller && (scroller.scrollTop = at));
    }
    if (c.focus !== undefined) {
      focusAt = -1;
      requestAnimationFrame(() => (set.focus !== 'off' ? pickFocus() : paintFocus()));
    } else requestAnimationFrame(() => paintFocus());
  }
  function widen(by: number) {
    const w = widthStep(set.width, by);
    if (w !== set.width) change({ width: w });
  }
  const cycleFocus = () => change({ focus: nextFocus(set.focus) });
  const cycleDim = () => change({ dim: nextDim(set.dim) });

  // ---- focus ----

  let stepping = false;

  /** Lights the first block in view (its first line). */
  function pickFocus() {
    if (!scroller || !us.length) return paintFocus();
    const s = scroller.scrollTop;
    const i = us.findIndex((u) => box(u).bottom > s + 8);
    focusAt = i < 0 ? 0 : i;
    lineAt = 0;
    if (set.focus === 'line' && i >= 0) {
      const ls = lines(us[focusAt]);
      const top = box(us[focusAt]).top;
      lineAt = Math.max(0, ls.findIndex(([t]) => top + t >= s));
    }
    paintFocus();
  }

  /** The lit block out of view after a scroll by hand: light what's in view instead. */
  function keepFocusInView() {
    if (focusAt < 0 || !us[focusAt] || !scroller) return;
    const b = box(us[focusAt]);
    const s = scroller.scrollTop;
    let top = b.top;
    let bottom = b.bottom;
    if (set.focus === 'line') {
      const l = lines(us[focusAt])[lineAt];
      if (l) [top, bottom] = [b.top + l[0], b.top + l[1]];
    }
    if (bottom < s || top > s + scroller.clientHeight) pickFocus();
  }

  /** Puts the focus classes and the line mask on the blocks. */
  function paintFocus() {
    for (const u of us) {
      u.classList.remove('lit');
      u.style.removeProperty('mask-image');
      u.style.removeProperty('-webkit-mask-image');
    }
    mark = null;
    if (!focusing || focusAt < 0 || !us[focusAt]) return;
    const u = us[focusAt];
    u.classList.add('lit');
    if (set.focus === 'line') {
      const ls = lines(u);
      const l = ls[Math.min(lineAt, ls.length - 1)];
      if (!l) return;
      const m = `rgba(0,0,0,${((1 + k) / 2).toFixed(2)})`;
      const g = `linear-gradient(to bottom, ${m} 0, ${m} ${l[0]}px, #000 ${l[0]}px, #000 ${l[1]}px, ${m} ${l[1]}px)`;
      u.style.setProperty('mask-image', g);
      u.style.setProperty('-webkit-mask-image', g);
      const b = box(u);
      const pageTop = host?.parentElement ? box(host.parentElement).top : 0;
      mark = { top: b.top - pageTop + l[0], height: l[1] - l[0] };
    }
  }

  function focusStep(by: number) {
    if (!us.length) return;
    if (focusAt < 0) return pickFocus();
    if (set.focus === 'line') {
      const n = lines(us[focusAt]).length;
      let i = focusAt;
      let j = lineAt + by;
      if (j < 0) {
        if (i === 0) return;
        i -= 1;
        j = lines(us[i]).length - 1;
      } else if (j >= n) {
        if (i === us.length - 1) return;
        i += 1;
        j = 0;
      }
      focusAt = i;
      lineAt = Math.max(0, j);
      const b = box(us[i]);
      const l = lines(us[i])[lineAt] ?? [0, 20];
      reveal(b.top + l[0], b.top + l[1], 0.2);
    } else {
      focusAt = Math.max(0, Math.min(us.length - 1, focusAt + by));
      lineAt = 0;
      const b = box(us[focusAt]);
      reveal(b.top, Math.min(b.bottom, b.top + (scroller?.clientHeight ?? 400) * 0.6), 0.12);
    }
    paintFocus();
  }

  // ---- headings and links ----

  function heading(by: number) {
    if (!host || !scroller) return;
    const hs = [...host.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => box(h).top);
    const s = scroller.scrollTop + 12;
    const t = by > 0 ? hs.find((y) => y > s + 4) : hs.filter((y) => y < s - 4).at(-1);
    if (t === undefined) return by > 0 ? store.notice('no heading below', 2000) : void (scroller.scrollTop = 0);
    scroller.scrollTop = Math.max(0, t - 12);
  }

  function selectLink(by: number) {
    if (!links.length || !scroller) return store.notice('no links here', 2000);
    const n = links.length;
    const s = scroller.scrollTop;
    const h = scroller.clientHeight;
    let i: number;
    if (linkSel >= 0) i = (linkSel + by + n) % n;
    else if (by > 0) i = Math.max(0, links.findIndex((a) => box(a).top >= s));
    else {
      i = n - 1;
      while (i > 0 && box(links[i]).top >= s + h) i--;
    }
    links[linkSel]?.classList.remove('sel');
    linkSel = i;
    links[i].classList.add('sel');
    const b = box(links[i]);
    reveal(b.top, b.bottom, 0.1);
  }

  function follow(a: HTMLAnchorElement) {
    const wiki = a.dataset.wiki;
    const ref = wiki !== undefined ? wikiKey(wiki) : a.dataset.href;
    if (ref === undefined) {
      if (a.href) env.host.openWeb(a.href);
      return;
    }
    const hash = anchorOf(wiki ?? ref);
    const bare = (wiki ?? ref).split('#')[0];
    if (!bare) return void (hash && jump(hash)); // a link inside this note
    const found = ref in (doc?.resolved ?? {}) ? doc!.resolved[ref] : wiki !== undefined ? null : resolveRelative(path, ref);
    if (!found) return void store.notice(wiki !== undefined || resolveRelative(path, ref) ? `not found: ${bare}` : `${bare} is not a Markdown note`);
    if (found === path) return void (hash && jump(hash));
    void store.follow(found, hash);
  }

  /** Scrolls to the heading named `id` (as a slug), when there is one. */
  function jump(id: string) {
    const want = slug(id);
    const h = [...(host?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [])].find((e) => slug(e.textContent ?? '') === want);
    if (h && scroller) scroller.scrollTop = Math.max(0, box(h).top - 12);
  }

  /** A task box was ticked: show it at once, ask the host, and put it back if the host could not. */
  async function onTick(e: Event) {
    const box = e.target as HTMLInputElement;
    const li = box.closest<HTMLElement>('li.md-task[data-line]');
    if (box.type !== 'checkbox' || !li || !env.host.setTask) return;
    const done = box.checked;
    const id = taskId(path, Number(li.dataset.line), li.dataset.tid);
    li.classList.toggle('md-done', done);
    let ok = false;
    try {
      ok = await env.host.setTask(id, done);
    } catch { /* the host could not: put it back */ }
    if (!ok) {
      box.checked = !done;
      li.classList.toggle('md-done', !done);
      store.notice('could not tick that task', 3000);
    }
  }

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault(); // web links go through the host too: a sandboxed frame cannot open a tab itself
    follow(a as HTMLAnchorElement);
  }

  /** "Ask zenbot": a draft "About <path>: " in a chat. */
  async function ask() {
    if (!store.path || !env.host.ask) return;
    try {
      if (await env.host.ask(store.path)) return;
    } catch { /* told below */ }
    store.notice('could not start a chat about this note', 3000);
  }

  function goBack() {
    if (!env.standalone && env.host.close?.()) return;
    if (!store.goBack()) close();
  }
  function close() {
    stop();
    if (!env.standalone && env.host.close?.()) return;
    store.close();
  }

  // ---- the changelog ----

  function toggleLog() {
    if (!hasLog) return store.notice('this file has no changelog', 2500);
    showLog = !showLog;
    if (showLog) requestAnimationFrame(logStats);
  }
  function logStats() {
    if (!logScroller || !showLog) return;
    const n = logUnits.length;
    if (!n) return void (logHint = 'changelog');
    const r = logScroller.getBoundingClientRect();
    const vis = logUnits.map((u, i) => [u.getBoundingClientRect(), i] as const).filter(([b]) => b.bottom > r.top + 2 && b.top < r.bottom - 2);
    const a = vis.length ? vis[0][1] + 1 : 1;
    const b = vis.length ? vis.at(-1)![1] + 1 : 1;
    logHint = `changelog · ${a}–${b} of ${n}`;
  }
  function logKey(key: string) {
    const l = logScroller;
    if (!l) return;
    const line = lineH();
    const page = l.clientHeight * 0.9;
    if (key === 'ArrowUp') l.scrollBy({ top: -line });
    else if (key === 'ArrowDown') l.scrollBy({ top: line });
    else if (key === 'PageUp') l.scrollBy({ top: -page });
    else if (key === 'PageDown') l.scrollBy({ top: page });
    else if (key === 'Home') l.scrollTop = 0;
    else if (key === 'End') l.scrollTop = l.scrollHeight;
  }

  // ---- play (one word at a time) ----

  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  let painted: HTMLElement | null = null;

  function startPlay() {
    if (!words.length || !scroller) return store.notice('nothing to play', 2000);
    const i = Math.min(words.length - 1, wordAt(scroller.scrollTop - 2));
    play = { at: i, playing: false };
    paintFocus();
    resume();
  }
  function resume() {
    if (!play) return;
    if (play.at >= words.length - 1 && !play.playing && ended) play.at = 0;
    ended = false;
    play.playing = true;
    due = performance.now() + dwell(wordText(play.at), set.wpm, set.pauses);
    paintWord();
    schedule();
  }
  let ended = $state(false);
  function pause() {
    if (!play) return;
    play.playing = false;
    clearTimeout(timer);
  }
  function schedule() {
    clearTimeout(timer);
    if (!play?.playing) return;
    timer = setTimeout(advance, Math.max(0, due - performance.now()));
  }
  function advance() {
    if (!play?.playing) return;
    const now = performance.now();
    if (play.at + 1 >= words.length) {
      play.playing = false;
      ended = true;
      return;
    }
    play.at += 1;
    const next = due + dwell(wordText(play.at), set.wpm, set.pauses);
    due = next < now ? now + dwell(wordText(play.at), set.wpm, set.pauses) : next;
    paintWord();
    schedule();
  }
  function step(by: number) {
    if (!play) return;
    pause();
    ended = false;
    play.at = Math.max(0, Math.min(words.length - 1, play.at + by));
    paintWord();
  }
  function stop() {
    clearTimeout(timer);
    painted?.classList.remove('cur');
    painted = null;
    ended = false;
    if (play) {
      play = null;
      requestAnimationFrame(() => paintFocus());
    }
  }
  function speed(by: number) {
    const wpm = Math.max(100, Math.min(1000, set.wpm + by));
    if (wpm !== set.wpm) change({ wpm }, false);
  }
  const wordText = (i: number) => words[i]?.textContent ?? '';

  /** The playing word bold in the text, which follows it. */
  function paintWord() {
    if (!play) return;
    painted?.classList.remove('cur');
    painted = words[play.at] ?? null;
    if (!painted || !scroller) return;
    painted.classList.add('cur');
    const t = wordTops()[play.at];
    const h = scroller.clientHeight;
    if (t !== undefined && (t < scroller.scrollTop + h * 0.15 || t > scroller.scrollTop + h * 0.7)) {
      stepping = true;
      scroller.scrollTop = Math.max(0, t - h / 3);
    }
  }

  const shown = $derived.by(() => {
    if (!play) return null;
    const w = wordText(play.at);
    const o = Math.min(orp(w), Math.max(0, [...w].length - 1));
    const cs = [...w];
    const ctx = (a: number, b: number) => Array.from({ length: b - a }, (_, j) => wordText(a + j)).filter(Boolean).join(' ');
    return {
      before: ctx(Math.max(0, play.at - 2), play.at),
      pre: cs.slice(0, o).join(''),
      pivot: cs[o] ?? '',
      post: cs.slice(o + 1).join(''),
      after: ctx(play.at + 1, Math.min(words.length, play.at + 3)),
    };
  });

  // ---- the source: the first web link among the properties (link, url, source first) ----

  const source = $derived(sourceLink(fm));
  function openSource() {
    if (source) env.host.openWeb(source);
    else store.notice('no web link in the properties', 2000);
  }

  // ---- keys ----

  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
  };

  function key(e: KeyboardEvent) {
    if (!typing(e) && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyO') {
      e.preventDefault();
      return openSource();
    }
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const done = () => e.preventDefault();
    if (play) {
      if (k === ' ' || k === 'p') play.playing ? pause() : resume();
      else if (k === 'ArrowUp') step(-1);
      else if (k === 'ArrowDown') step(1);
      else if (k === '+' || k === '=') speed(50);
      else if (k === '-') speed(-50);
      else if (k === '.') change({ pauses: !set.pauses }, false);
      else if (k === 'Escape' || k === 'ArrowLeft' || k === 'Backspace') stop();
      else return;
      return done();
    }
    if (showLog && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape'].includes(k)) {
      if (k === 'Escape') showLog = false;
      else logKey(k);
      return done();
    }
    switch (k) {
      case 'i':
        propsOpen = !propsOpen;
        break;
      case 'h':
        toggleLog();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (focusing) focusStep(k === 'ArrowUp' ? -1 : 1);
        else scrollBy(k === 'ArrowUp' ? -lineH() : lineH());
        break;
      case 'PageUp':
        scrollBy(-pageH());
        break;
      case 'PageDown':
        scrollBy(pageH());
        break;
      case ' ':
        scrollBy(e.shiftKey ? -pageH() : pageH());
        break;
      case 'Home':
        if (scroller) scroller.scrollTop = 0;
        break;
      case 'End':
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        break;
      case '<':
        widen(-1);
        break;
      case '>':
        widen(1);
        break;
      case ':':
        change({ spaced: !set.spaced });
        break;
      case 'b':
        change({ bionic: !set.bionic });
        break;
      case 'f':
        cycleFocus();
        break;
      case 'd':
        cycleDim();
        break;
      case '.':
        change({ pauses: !set.pauses }, false);
        store.notice(`play: pauses ${set.pauses ? 'on' : 'off'}`, 2000);
        break;
      case 'p':
        startPlay();
        break;
      case '[':
        heading(-1);
        break;
      case ']':
        heading(1);
        break;
      case 'l':
        selectLink(1);
        break;
      case 'L':
        selectLink(-1);
        break;
      case 'n':
        sibling(1);
        break;
      case 'N':
        sibling(-1);
        break;
      case 'Enter':
        if (linkSel >= 0 && links[linkSel]) follow(links[linkSel]);
        else return;
        break;
      case 'ArrowLeft':
      case 'Backspace':
        goBack();
        break;
      case 'Escape':
        close();
        break;
      default:
        return;
    }
    done();
  }
</script>

<svelte:window onkeydown={key} />

<div class="reader prose" class:spaced={set.spaced} style:--keep={k} data-testid="reader">
  <div class="top" class:zen={inZen}>
    {#if inZen}
      <div class="zbar">
        {#if doc}<span class="dim zprog" data-testid="progress">{pct}%{#if wordsLeft} · {minutes} min left{/if}</span>{/if}
        <span class="sp"></span>
        {#if doc?.at && (doc.count ?? 0) > 1}
          <div class="sib" role="group" aria-label="notes in this folder">
            <button class="nb" onclick={() => sibling(-1)} disabled={!hasPrev} title="previous note in this folder (N)" aria-label="Previous note">‹</button>
            <span class="cnt" data-testid="count" title={`${folder || store.label || 'Notes'}: ${doc.at} of ${doc.count}`}>{doc.at} of {doc.count}</span>
            <button class="nb" onclick={() => sibling(1)} disabled={!hasNext} title="next note in this folder (n)" aria-label="Next note">›</button>
          </div>
        {/if}
        {#if env.host.editNote}<button class="rb" onclick={() => store.path && env.host.editNote?.(store.path)} title="Edit this note">Edit</button>{/if}
        {#if env.host.ask}<button class="rb pri" onclick={ask} title="Ask zenbot about this note">Ask zenbot</button>{/if}
        <button class="aa" class:on={aids} onclick={() => (aids = !aids)} title="reading aids" aria-expanded={aids}>Aa</button>
      </div>
    {:else}
      <div class="title">
        <span class="name">{name}</span>
        {#if doc}<span class="dim">&nbsp;·&nbsp;{pct}%{#if wordsLeft}&nbsp;·&nbsp;{minutes} min left{/if}</span>{/if}
        <span class="folder dim" title={folder || 'the folder'}><bdi>{folder || store.label}</bdi></span>
      </div>
    {/if}
    <div class="tools" class:hidden={inZen && !aids} role="toolbar" aria-label="reader">
      {#if !inZen}<button onclick={goBack} title={canBack ? 'back (← or backspace)' : 'close (esc)'}>{canBack ? '←' : '✕'}</button>{/if}
      {#if !inZen}
        <button onclick={() => sibling(-1)} disabled={!hasPrev} title="previous file in this folder (N)">‹ prev</button>
        {#if doc?.at && (doc.count ?? 0) > 1}<span class="val dim" title="place in this folder">{doc.at} of {doc.count}</span>{/if}
        <button onclick={() => sibling(1)} disabled={!hasNext} title="next file in this folder (n)">next ›</button>
      {/if}
      <span class="sep"></span>
      <button onclick={() => widen(-1)} title="narrower (<)" disabled={set.width === 60}>‹</button>
      <span class="val" title="line width" data-testid="width">{set.width || 'full'}</span>
      <button onclick={() => widen(1)} title="wider (>)" disabled={set.width === 0}>›</button>
      <button class:on={set.spaced} onclick={() => change({ spaced: !set.spaced })} title="line spacing (:)">↕</button>
      <button class:on={set.bionic} onclick={() => change({ bionic: !set.bionic })} title="bionic (b)"><b>Bi</b>o</button>
      <button class:on={set.focus !== 'off'} onclick={cycleFocus} title="focus: off → paragraph → line (f)">{set.focus === 'line' ? '― line' : set.focus === 'paragraph' ? '¶ para' : '¶ off'}</button>
      <button onclick={cycleDim} title="dim level (d)">◐ {set.dim}</button>
      <span class="sep"></span>
      <button onclick={() => heading(-1)} title="previous heading ([)">§↑</button>
      <button onclick={() => heading(1)} title="next heading (])">§↓</button>
      <button onclick={() => selectLink(-1)} title="previous link (L)">‹link</button>
      <button onclick={() => selectLink(1)} title="next link (l)">link›</button>
      {#if linkSel >= 0}<button onclick={() => links[linkSel] && follow(links[linkSel])} title="follow the selected link (enter)">go ↵</button>{/if}
      <span class="sep"></span>
      {#if source}<button onclick={openSource} title={`open the source (Alt+O): ${source}`}>↗ source</button>{/if}
      {#if fm.length}<button class:on={propsOpen} onclick={() => (propsOpen = !propsOpen)} title="properties (i)">i</button>{/if}
      {#if hasLog}<button class:on={showLog} onclick={toggleLog} title="changelog (h)">log</button>{/if}
      <button class:on={!!play} onclick={() => (play ? stop() : startPlay())} title="play one word at a time (p)">{play ? '■ stop' : '▶ play'}</button>
      <button class:on={set.pauses} onclick={() => change({ pauses: !set.pauses }, false)} title="longer stays at punctuation and long words (.)">pauses</button>
    </div>
  </div>

  {#if loading && !doc}
    <p class="msg dim">reading…</p>
  {:else if error}
    <p class="msg err">{error}</p>
  {/if}

  <div class="scroll" bind:this={scroller} onscroll={onScroll} class:hidden={!doc}>
    <div class="rpage" style:max-width={set.width ? `calc(${set.width}ch + 48px)` : 'none'} class:focusing class:playing={!!play}>
      {#if inZen}
        <h1 class="ztitle" data-testid="title">{title}</h1>
        {#if zchips.length}
          <div class="chips" data-testid="chips">
            {#each zchips as c}
              {#if c.tag}<span class="chip tag">#{c.value}</span>{:else}<span class="chip" title={c.key}>{#if c.key.toLowerCase() !== 'type'}<em>{c.key}</em>{/if}{c.value}</span>{/if}
            {/each}
          </div>
        {/if}
      {:else if fm.length}
        {#if propsOpen}
          <button class="fm open" onclick={() => (propsOpen = false)} title="fold (i)">
            {#each fm as [key, v]}<span class="pk">{key}</span><span class="pv">{v}</span>{/each}
          </button>
        {:else}
          <button class="fm" onclick={() => (propsOpen = true)} title="one row per property (i)">
            {#each fm as [key, v], j}{j ? ' · ' : ''}<span class="pk">{key}:</span> {v}{/each}
          </button>
        {/if}
      {/if}
      <div class="body" bind:this={host} onclick={onClick} onchange={onTick} role="presentation">
      </div>
      {#if linked.length}
        <nav class="linked" aria-label="Linked from" data-testid="linked">
          <div class="lh">Linked from</div>
          {#each linked as b (b.path)}
            <button class="ll" onclick={() => void store.follow(b.path)} title={b.path}>
              <span>{b.title}</span><small>{dirOf(b.path) || store.label || 'Vault'}</small>
            </button>
          {/each}
        </nav>
      {/if}
      {#if mark}<span class="mark" style:top="{mark.top}px" style:height="{mark.height}px"></span>{/if}
    </div>
  </div>

  <div class="clog" class:hidden={!showLog || !!play}>
    <div class="clog-head dim">
      <span>{logHint}</span>
      <button onclick={() => (showLog = false)} title="hide (h or esc)">✕</button>
    </div>
    <div class="clog-scroll" bind:this={logScroller} onscroll={logStats}>
      <div class="rpage" style:max-width={set.width ? `calc(${set.width}ch + 48px)` : 'none'}>
        <div class="body" bind:this={logHost} onclick={onClick} role="presentation"></div>
      </div>
    </div>
  </div>

  {#if play && shown}
    <div class="player">
      <div class="rsvp" aria-live="off">
        <span class="tick">▼</span>
        <div class="line">
          <span class="left"><span><span class="ctx">{shown.before}</span>{shown.before ? ' ' : ''}{shown.pre}</span></span>
          <span class="pivot">{shown.pivot}</span>
          <span class="right"><span>{shown.post}{shown.after ? ' ' : ''}<span class="ctx">{shown.after}</span></span></span>
        </div>
        <span class="tick">▲</span>
      </div>
      <div class="pstat dim">
        <button onclick={() => speed(-50)} title="slower (-)">−</button>
        <span>{set.wpm} wpm</span>
        <button onclick={() => speed(50)} title="faster (+)">+</button>
        <span>·</span>
        <button onclick={() => step(-1)} title="a word back (↑)">⏮</button>
        <button onclick={() => (play?.playing ? pause() : resume())} title="pause / resume (space)">{play.playing ? '⏸' : '▶'}</button>
        <button onclick={() => step(1)} title="a word on (↓)">⏭</button>
        <span>{play.playing ? 'playing' : ended ? 'the end' : 'paused'} · word {play.at + 1} of {nWords}</span>
        <button class:on={set.pauses} onclick={() => change({ pauses: !set.pauses }, false)} title="pauses (.)">pauses</button>
        <button onclick={stop} title="stop here (esc)">■</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .reader { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--paper); color: var(--ink); position: relative; }
  .top { flex: none; padding: 8px 14px 6px; border-bottom: 1px solid var(--faint); font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
  .zbar { display: flex; align-items: center; gap: 8px; min-height: 28px; }
  .zbar .sp { flex: 1; }
  .rb { padding: 3px 12px; border-radius: var(--r-full); font-size: 13px; font-weight: 600; border: 1px solid var(--faint); white-space: nowrap; }
  .rb:hover { border-color: var(--dim); }
  .rb.pri { background: var(--accent-fill); border-color: var(--accent-fill); color: var(--on-accent); }
  .rb.pri:hover { filter: brightness(1.06); }
  .zbar { flex-wrap: wrap; }
  .zbar .aa { padding: 3px 10px; border-radius: var(--r-full); border: 1px solid var(--faint); color: var(--dim); font-family: var(--heading); font-size: 13px; }
  .zbar .aa:hover { color: var(--ink); border-color: var(--dim); }
  .zbar .aa.on { color: var(--accent); border-color: var(--accent); }
  .zprog { font-size: 12px; font-variant-numeric: tabular-nums; }
  .sib { display: flex; align-items: center; border: 1px solid var(--faint); border-radius: var(--r-full); }
  .sib .nb { width: 28px; height: 26px; font-size: 18px; line-height: 1; color: var(--dim); border-radius: var(--r-full); }
  .sib .nb:hover:not(:disabled) { color: var(--ink); background: var(--soft); }
  .sib .nb:disabled { opacity: 0.35; }
  .sib .cnt { font-size: 12px; color: var(--dim); padding: 0 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .top.zen { border-bottom-color: transparent; }
  .title { display: flex; align-items: baseline; gap: 0; min-width: 0; white-space: nowrap; }
  .title .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 3em; }
  .title > .dim { flex: none; }
  .title .folder { flex: 1 1 0; margin-left: auto; padding-left: 12px; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: right; min-width: 0; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; color: var(--dim); }
  .tools button, .pstat button { padding: 2px 7px; border-radius: 5px; color: var(--dim); white-space: nowrap; }
  .tools button:hover, .pstat button:hover { color: var(--ink); background: color-mix(in srgb, var(--faint) 45%, transparent); }
  .tools button:disabled { opacity: 0.35; cursor: default; background: none; }
  .tools button.on, .pstat button.on { color: var(--accent); }
  .tools .val { min-width: 2.2em; text-align: center; font-variant-numeric: tabular-nums; }
  .sep { width: 1px; height: 14px; background: var(--faint); margin: 0 4px; }
  .msg { padding: 24px 20px; margin: 0; }
  .err { color: var(--err); }
  .hidden { display: none !important; }

  .scroll { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .rpage { margin: 0 auto; padding: 22px 24px 30vh; position: relative; font-family: var(--mono); font-size: 14px; line-height: 1.6; }
  .prose .rpage { font-family: var(--serif); font-size: 19px; line-height: 1.7; }
  .prose.spaced .rpage { line-height: 2.15; }
  .spaced .rpage { line-height: 2; }
  .clog .rpage { padding-top: 6px; padding-bottom: 12px; }

  .ztitle { font-family: var(--heading); font-weight: 600; font-size: 1.7em; line-height: 1.2; margin: 0.2em 0 0.35em; overflow-wrap: anywhere; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 1.4em; font-family: var(--sans); }
  .chip { font-size: 12px; line-height: 1.5; padding: 1px 9px; border-radius: var(--r-full); background: var(--soft); color: var(--ink); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip em { font-style: normal; color: var(--dim); margin-right: 5px; }
  .chip.tag { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .fm { display: block; width: 100%; text-align: left; color: var(--dim); font-family: var(--sans); font-size: 13px; line-height: 1.6; margin: 0 0 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fm .pk { color: var(--dim); }
  .fm.open { display: grid; grid-template-columns: max-content 1fr; gap: 0 14px; white-space: normal; }
  .fm.open .pv { color: var(--ink); overflow-wrap: anywhere; }

  .linked { margin: 2.2em 0 0; padding-top: 14px; border-top: 1px solid var(--faint); font-family: var(--sans); }
  .lh { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); font-weight: 650; margin-bottom: 6px; }
  .ll { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 7px 8px; border-radius: var(--r-md); font-size: 15px; text-align: left; }
  .ll span { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ll small { margin-left: auto; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dim); }
  .ll:hover { background: var(--soft); }
  .mark { position: absolute; left: 6px; width: 3px; border-radius: 2px; background: var(--accent); }

  /* the rendered text */
  .body :global(pre.plain) { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  .body :global(.md) { overflow-wrap: break-word; }
  .body :global(.md > :first-child) { margin-top: 0; }
  .body :global(h1), .body :global(h2), .body :global(h3), .body :global(h4), .body :global(h5), .body :global(h6) { font-family: var(--heading); line-height: 1.3; margin: 1.4em 0 0.5em; }
  .body :global(h1) { font-size: 1.6em; }
  .body :global(h2) { font-size: 1.3em; }
  .body :global(h3) { font-size: 1.12em; }
  .body :global(h4), .body :global(h5), .body :global(h6) { font-size: 1em; }
  .body :global(p) { margin: 0 0 0.9em; }
  .body :global(ul), .body :global(ol) { margin: 0 0 0.9em; padding-left: 1.4em; }
  .body :global(li > p) { margin: 0 0 0.25em; }
  .body :global(li.md-task) { list-style: none; }
  .body :global(li.md-task input) { margin: 0 0.4em 0 -1.3em; accent-color: var(--accent-fill); }
  .body :global(li.md-task input:not(:disabled)) { cursor: pointer; }
  .body :global(li.md-done) { color: var(--dim); }
  .body :global(blockquote) { margin: 0 0 0.9em; padding-left: 1em; border-left: 3px solid var(--faint); color: color-mix(in srgb, var(--ink) 80%, var(--paper)); }
  .body :global(.md-callout) { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); padding: 0.5em 0.9em; border-radius: 4px; }
  .body :global(.md-callout-title) { font-weight: 600; font-family: var(--sans); font-size: 0.85em; margin-bottom: 0.3em; }
  .body :global(code) { font-family: var(--mono); font-size: 0.82em; background: color-mix(in srgb, var(--faint) 45%, transparent); padding: 0.1em 0.3em; border-radius: 4px; }
  .body :global(pre:not(.plain)) { font-family: var(--mono); font-size: 0.78em; line-height: 1.55; background: color-mix(in srgb, var(--faint) 35%, transparent); padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; margin: 0 0 1em; }
  .body :global(pre code) { background: none; padding: 0; font-size: 1em; }
  .body :global(table) { border-collapse: collapse; font-family: var(--sans); font-size: 0.78em; margin: 0 0 1em; display: block; overflow-x: auto; max-width: 100%; }
  .body :global(th), .body :global(td) { border: 1px solid var(--faint); padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
  .body :global(td code) { white-space: nowrap; }
  .body :global(th) { background: color-mix(in srgb, var(--faint) 30%, transparent); }
  .body :global(hr) { border: 0; border-top: 1px solid var(--faint); margin: 1.5em 0; }
  .body :global(img) { max-width: 100%; }
  .body :global(a) { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); cursor: pointer; }
  .body :global(a:hover) { border-bottom-color: var(--accent); }
  .body :global(a.md-wiki) { border-bottom-style: dotted; }
  .body :global(a.missing) { color: var(--dim); border-bottom-style: dashed; }
  .body :global(a.sel) { background: color-mix(in srgb, var(--accent) 18%, transparent); outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); border-radius: 3px; }
  .body :global(.md-html) { font-family: var(--mono); font-size: 0.8em; color: var(--dim); }
  .body :global(.md-display) { display: block; overflow-x: auto; overflow-y: hidden; margin: 0 0 1em; }
  .body :global(b.md-bionic) { font-weight: 700; }

  /* focus: the lit block in full, the rest dimmed */
  .focusing :global(.u) { transition: opacity 0.15s; }
  .focusing :global(.u:not(.lit)) { opacity: var(--keep); }

  /* play: the text dimmed, the word playing bold */
  .playing :global(.md), .playing :global(.md *), .playing :global(pre.plain) { color: color-mix(in srgb, var(--ink) calc(var(--keep) * 100%), var(--paper)) !important; }
  .playing :global(.w.cur), .playing :global(.w.cur *) { color: var(--ink) !important; font-weight: 700; }

  .clog { flex: none; display: flex; flex-direction: column; max-height: 33%; min-height: 7.5em; border-top: 1px solid var(--faint); background: color-mix(in srgb, var(--faint) 12%, var(--paper)); }
  .clog-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 14px; font-size: 12px; }
  .clog-head button { color: var(--dim); }
  .clog-scroll { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .clog .rpage { font-size: 16px; }

  .player { flex: none; border-top: 1px solid var(--faint); padding: 8px 12px 10px; background: var(--paper); }
  .rsvp { display: flex; flex-direction: column; align-items: stretch; font-family: var(--serif); }
  .tick { text-align: center; color: var(--dim); font-size: 10px; line-height: 1; }
  .line { display: grid; grid-template-columns: 1fr auto 1fr; font-size: 30px; line-height: 1.35; white-space: nowrap; }
  .line .left { overflow: hidden; display: flex; justify-content: flex-end; }
  .line .left > span { flex: none; white-space: pre; }
  .line .right > span { white-space: pre; }
  .line .right { overflow: hidden; }
  .line .ctx { color: var(--dim); opacity: 0.55; font-size: 0.7em; }
  .line .pivot { color: var(--err); }
  .pstat { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px 6px; font-size: 12px; margin-top: 4px; font-variant-numeric: tabular-nums; }

  :global(:root[data-narrow]) .rpage { padding: 14px 16px 30vh; }
  :global(:root[data-narrow]) .prose .rpage { font-size: 18px; }
  :global(:root[data-narrow]) .line { font-size: 26px; }
  @media (max-width: 640px) {
    .rpage { padding: 16px 16px 30vh; }
    .prose .rpage { font-size: 18px; }
    .line { font-size: 26px; }
    .title .folder { display: none; }
  }
</style>
