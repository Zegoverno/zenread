// The reading aids and their settings: pure, so the PWA (localStorage) and the server (a file in
// the plugin's data folder) keep exactly the same shape.

/** Silent reading speed for non-fiction, words a minute (Brysbaert 2019), for the minutes left. */
export const WPM = 238;
/** Prose widths `<` and `>` go through, in characters; 0 is the whole pane. */
export const MEASURES = [60, 72, 90, 0] as const;
/** The dim levels, light to strong. */
export const DIMS = [100, 300, 500, 700, 900] as const;
export const FOCUS = ['off', 'paragraph', 'line'] as const;

export interface ReaderSettings {
  /** Play speed, words a minute. */
  wpm: number;
  /** Play: longer stays at punctuation and long words. */
  pauses: boolean;
  width: (typeof MEASURES)[number];
  spaced: boolean;
  bionic: boolean;
  focus: (typeof FOCUS)[number];
  dim: (typeof DIMS)[number];
}

export const DEFAULTS: ReaderSettings = { wpm: 200, pauses: false, width: 72, spaced: false, bionic: false, focus: 'off', dim: 300 };

/** How much of the ink stays at each dim level. */
export const keep = (dim: number): number => ({ 100: 0.75, 300: 0.55, 500: 0.4, 700: 0.25, 900: 0.12 })[dim as 100] ?? 0.55;

/** Anything (a parsed file, a tool's argument) as valid settings: unknown keys and bad values dropped. */
export function normalize(raw: unknown, base: ReaderSettings = DEFAULTS): ReaderSettings {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.wpm === 'number' && Number.isFinite(r.wpm)) out.wpm = Math.max(100, Math.min(1000, Math.round(r.wpm)));
  if (typeof r.pauses === 'boolean') out.pauses = r.pauses;
  if (typeof r.spaced === 'boolean') out.spaced = r.spaced;
  if (typeof r.bionic === 'boolean') out.bionic = r.bionic;
  if ((MEASURES as readonly unknown[]).includes(r.width)) out.width = r.width as ReaderSettings['width'];
  if ((FOCUS as readonly unknown[]).includes(r.focus)) out.focus = r.focus as ReaderSettings['focus'];
  if ((DIMS as readonly unknown[]).includes(r.dim)) out.dim = r.dim as ReaderSettings['dim'];
  return out;
}

/** The width one step narrower (-1) or wider (1); the same when at the end. */
export function widen(width: ReaderSettings['width'], by: number): ReaderSettings['width'] {
  const i = MEASURES.indexOf(width);
  const j = Math.max(0, Math.min(MEASURES.length - 1, (i < 0 ? 1 : i) + by));
  return MEASURES[j];
}

export const nextFocus = (f: ReaderSettings['focus']): ReaderSettings['focus'] => FOCUS[(FOCUS.indexOf(f) + 1) % FOCUS.length];
export const nextDim = (d: ReaderSettings['dim']): ReaderSettings['dim'] => DIMS[(DIMS.indexOf(d) + 1) % DIMS.length];

export function describe(s: ReaderSettings): string {
  const w = s.width ? `${s.width} columns` : 'full width';
  return [w, s.spaced && 'spaced', s.bionic && 'bionic', s.focus !== 'off' && `${s.focus} focus · dim ${s.dim}`].filter(Boolean).join(' · ');
}
