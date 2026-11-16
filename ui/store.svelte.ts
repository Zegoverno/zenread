// What the page keeps while it lives: the source, the open note, the way back through the links
// followed, where each note was left, the settings and a short message.
import { dirOf } from '../core/links.ts';
import { DEFAULTS, describe, normalize } from '../core/settings.ts';
import type { ReaderSettings } from '../core/settings.ts';
import type { Env, Source } from './adapters.ts';

export interface OpenOptions {
  /** Start a new trail: the way back is dropped (an unrelated open, as the next note in a folder). */
  fresh?: boolean;
  anchor?: string;
}

export function createStore(env: Env) {
  let source = $state.raw<Source | null>(env.source);
  const st = $state({ path: null as string | null, anchor: '', nonce: 0, back: [] as string[], dir: '', settings: { ...DEFAULTS } as ReaderSettings, toast: '' });
  const scrolls = new Map<string, number>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const store = {
    get source() { return source; },
    get label() { return source?.label ?? ''; },
    get path() { return st.path; },
    get anchor() { return st.anchor; },
    get nonce() { return st.nonce; },
    get back() { return st.back; },
    get dir() { return st.dir; },
    /** Called with the path each time a note is opened (a host mirrors it to the chat). */
    onOpen: null as ((path: string) => void) | null,
    set dir(d: string) { st.dir = d; },
    get settings() { return st.settings; },
    get toast() { return st.toast; },
    scrolls,

    async init() {
      st.settings = await env.settings.load();
    },
    setSource(s: Source | null) {
      source = s;
      st.path = null;
      st.back = [];
      st.dir = '';
      scrolls.clear();
    },
    open(path: string, o: OpenOptions = {}) {
      if (o.fresh) st.back = [];
      st.anchor = o.anchor ?? '';
      st.path = path;
      st.dir = dirOf(path);
      st.nonce++;
      store.onOpen?.(path);
    },
    /** Follow a link to another note: the host may take it, else it opens here with a way back. */
    async follow(path: string, anchor = '') {
      try {
        if (env.host.openNote && (await env.host.openNote(path))) return;
      } catch { /* the host could not: open it here */ }
      if (st.path) st.back = [...st.back, st.path];
      store.open(path, { anchor });
    },
    /** One step back through the links followed; false when there is none. */
    goBack(): boolean {
      const prev = st.back.at(-1);
      if (!prev) return false;
      st.back = st.back.slice(0, -1);
      store.open(prev);
      return true;
    },
    close() {
      st.path = null;
      st.back = [];
    },
    change(patch: Partial<ReaderSettings>, label = true) {
      st.settings = normalize(patch, st.settings);
      env.settings.save($state.snapshot(st.settings)).catch((e) => store.notice(`settings not saved: ${(e as Error).message}`));
      if (label) store.notice(`reading: ${describe(st.settings)}`, 3000);
    },
    notice(message: string, ms = 4000) {
      st.toast = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (st.toast = ''), ms);
    },
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;
