// zenbot's keyboard model for the reader (PLUGINS.md, "Keys and commands"). An iframe swallows the keys
// pressed in it, so under zenbot the page takes part through three notifications over the App channel:
//   zen/commands  what the reader can do (id, title, default key, ring), sent again when it changes;
//   zen/key       every keydown the reader did not handle, so zenbot's own shortcuts work in the pane;
//   zen/command   zenbot asks for a command (picked in the ring or the list, or its key pressed).
//   zen/focus     the pane gained or lost the keyboard focus: the reader takes it on `true`.
// Nothing here runs outside zenbot: host.ts plugs `bus` in only when the host context has `zen`, and the
// PWA and other hosts keep handling their keys themselves (host.ts sends only when the context says zenbot;
// the reader checks `zen.active` before it publishes, forwards or hands a key over).

export interface ZenCommand {
  /** `[a-z0-9-]{1,32}`, stable across sends. */
  id: string;
  /** Up to 60 characters. */
  title: string;
  /** The default shortcut in zen's key form ("e", "Shift+n", "Mod+Enter"); absent: none. */
  key?: string;
  /** Ask for a place in the ring (zenbot shows at most four, in the order sent). */
  ring?: boolean;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
}

/** The keys zenbot keeps for itself: a command asking for one gets no shortcut. */
export const RESERVED = new Set(['Mod+k', 'Mod+.', 'Mod+\\', 'Mod+Shift+\\', '?', 'Escape', 'g']);

/** An event as zen's key form: `Mod`, `Alt`, `Shift` in that order, then the key (letters in lower case,
 *  `Space` for the space bar). Shift is written only with letters and named keys: `?` and `<` are as typed. */
export function keyForm(e: KeyLike): string {
  const k = e.key === ' ' ? 'Space' : e.key;
  const named = k.length > 1;
  const letter = k.length === 1 && k.toLowerCase() !== k.toUpperCase();
  const mods = [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey && (named || letter) ? 'Shift' : ''].filter(Boolean);
  return [...mods, letter ? k.toLowerCase() : k].join('+');
}

/** The `zen/key` parameters of a keydown. */
export function keyParams(e: KeyLike, typing: boolean) {
  return { key: e.key, code: e.code ?? '', ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, typing };
}

/** The contract's rule: forward what the page did not handle; while typing, only Ctrl or Meta combinations. */
export const forwardable = (e: KeyLike, typing: boolean): boolean => !e.defaultPrevented && (!typing || e.ctrlKey || e.metaKey);

const ID = /^[a-z0-9-]{1,32}$/;

/** Keeps what zenbot accepts: at most 30 commands, valid ids, titles cut to 60, no reserved or repeated keys. */
export function clean(list: ZenCommand[]): ZenCommand[] {
  const seen = new Set<string>();
  const keys = new Set<string>();
  const out: ZenCommand[] = [];
  for (const c of list) {
    if (!ID.test(c.id) || seen.has(c.id) || out.length >= 30) continue;
    seen.add(c.id);
    const o: ZenCommand = { id: c.id, title: c.title.slice(0, 60) };
    if (c.key && !RESERVED.has(c.key) && !keys.has(c.key)) {
      keys.add(c.key);
      o.key = c.key;
    }
    if (c.ring) o.ring = true;
    out.push(o);
  }
  return out;
}

/** The wire between the reader and zenbot's host. host.ts fills the senders under zenbot; the reader fills `run` and `focus`. */
export const bus = {
  /** Set by host.ts; it sends only while the host is zenbot. Null in the PWA (nothing is sent). */
  send: null as ((method: string, params: Record<string, unknown>) => void) | null,
  /** Run a command by id; false when the reader has no such command (or cannot now). */
  run: null as ((id: string) => boolean) | null,
  /** Put the keyboard focus where the reader expects it (the reading area). */
  focus: null as (() => void) | null,
  /** The keys the reader's commands use, whether declared now or not: under zenbot they are not handled locally. */
  keys: new Set<string>(),
  last: '',
};

/** Sends the command list when it is new. Returns true when something was sent. */
export function publish(list: ZenCommand[]): boolean {
  if (!bus.send) return false;
  const commands = clean(list);
  const json = JSON.stringify(commands);
  if (json === bus.last) return false;
  bus.last = json;
  bus.send('zen/commands', { commands });
  return true;
}

/** Forwards a keydown zenbot should see. Returns true when it was sent. */
export function forward(e: KeyLike, typing: boolean): boolean {
  if (!bus.send || !forwardable(e, typing)) return false;
  bus.send('zen/key', keyParams(e, typing));
  return true;
}

/** True for a keydown that is one of the reader's command keys: under zenbot it goes to zenbot, not to the page. */
export const owned = (e: KeyLike): boolean => bus.keys.has(keyForm(e));

/** Focus is in a text field or an editable area (the contract's `typing`). */
export const isTyping = (e: { target: EventTarget | null }): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (/^(input|textarea|select)$/i.test(t.tagName ?? '') || !!t.isContentEditable);
};
