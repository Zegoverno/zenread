import { describe as suite, expect, it } from 'vitest';
import { DEFAULTS, describe, keep, nextDim, nextFocus, normalize, widen } from './settings.ts';

suite('settings', () => {
  it('keeps valid values and drops the rest', () => {
    const s = normalize({ wpm: 5000, width: 90, focus: 'line', dim: 500, bionic: true, spaced: 'yes', bogus: 1, pauses: true });
    expect(s).toEqual({ ...DEFAULTS, wpm: 1000, width: 90, focus: 'line', dim: 500, bionic: true, pauses: true });
    expect(normalize(null)).toEqual(DEFAULTS);
    expect(normalize({ width: 75, dim: 123, focus: 'word', wpm: Number.NaN })).toEqual(DEFAULTS);
  });
  it('applies over a base without mutating it', () => {
    const base = { ...DEFAULTS, bionic: true };
    expect(normalize({ spaced: true }, base)).toEqual({ ...base, spaced: true });
    expect(base.spaced).toBe(false);
  });
  it('steps width, focus and dim, stopping at the ends', () => {
    expect(widen(72, -1)).toBe(60);
    expect(widen(60, -1)).toBe(60);
    expect(widen(90, 1)).toBe(0);
    expect(widen(0, 1)).toBe(0);
    expect(nextFocus('off')).toBe('paragraph');
    expect(nextFocus('line')).toBe('off');
    expect(nextDim(900)).toBe(100);
  });
  it('maps dim to how much ink stays, lighter dim keeping more', () => {
    expect(keep(100)).toBeGreaterThan(keep(900));
    expect(keep(42)).toBe(0.55);
  });
  it('describes the aids that are on', () => {
    expect(describe(DEFAULTS)).toBe('72 columns');
    expect(describe({ ...DEFAULTS, width: 0, bionic: true, focus: 'line' })).toBe('full width · bionic · line focus · dim 300');
  });
});
