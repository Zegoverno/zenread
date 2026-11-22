import { afterEach, describe, expect, it } from 'vitest';
import { bus, clean, forward, forwardable, keyForm, keyParams, owned, publish } from './zenkeys.ts';
import type { KeyLike } from './zenkeys.ts';

const ev = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('zen key form', () => {
  it('writes letters in lower case, Space for the bar, and Shift only with letters and named keys', () => {
    expect(keyForm(ev('n'))).toBe('n');
    expect(keyForm(ev('N', { shiftKey: true }))).toBe('Shift+n');
    expect(keyForm(ev(' '))).toBe('Space');
    expect(keyForm(ev('?', { shiftKey: true }))).toBe('?');
    expect(keyForm(ev('<', { shiftKey: true }))).toBe('<');
    expect(keyForm(ev('Enter', { ctrlKey: true }))).toBe('Mod+Enter');
    expect(keyForm(ev('ArrowUp', { altKey: true }))).toBe('Alt+ArrowUp');
    expect(keyForm(ev('K', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+k');
    expect(keyForm(ev('\\', { ctrlKey: true, shiftKey: true }))).toBe('Mod+\\');
    expect(keyForm(ev('Escape'))).toBe('Escape');
  });
});

describe('what is forwarded', () => {
  it('forwards unhandled keys; while typing only Ctrl or Meta combinations; never a handled one', () => {
    expect(forwardable(ev('x'), false)).toBe(true);
    expect(forwardable(ev('x', { defaultPrevented: true }), false)).toBe(false);
    expect(forwardable(ev('x'), true)).toBe(false);
    expect(forwardable(ev('k', { ctrlKey: true }), true)).toBe(true);
    expect(forwardable(ev('k', { metaKey: true }), true)).toBe(true);
    expect(forwardable(ev('k', { altKey: true }), true)).toBe(false);
  });
  it('carries the KeyboardEvent fields', () => {
    expect(keyParams(ev('k', { code: 'KeyK', ctrlKey: true }), true)).toEqual({ key: 'k', code: 'KeyK', ctrl: true, meta: false, alt: false, shift: false, typing: true });
  });
});

describe('the command list', () => {
  it('keeps valid, unique commands: 30 at most, titles to 60, no reserved or repeated key', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, title: 'x' }));
    expect(clean(many)).toHaveLength(30);
    expect(clean([{ id: 'Bad Id', title: 't' }, { id: 'ok', title: 't' }, { id: 'ok', title: 'again' }]).map((c) => c.id)).toEqual(['ok']);
    expect(clean([{ id: 'a', title: 'x'.repeat(80) }])[0].title).toHaveLength(60);
    const keys = clean([
      { id: 'a', title: 'a', key: 'g' },
      { id: 'b', title: 'b', key: 'Escape' },
      { id: 'c', title: 'c', key: 'Mod+k' },
      { id: 'd', title: 'd', key: 'e', ring: true },
      { id: 'f', title: 'f', key: 'e' },
    ]);
    expect(keys.map((c) => c.key)).toEqual([undefined, undefined, undefined, 'e', undefined]);
    expect(keys[3].ring).toBe(true);
    expect(keys[0]).not.toHaveProperty('ring');
  });
});

describe('the bus', () => {
  afterEach(() => {
    bus.send = null;
    bus.last = '';
    bus.keys = new Set();
  });
  it('sends nothing without a zenbot host', () => {
    expect(publish([{ id: 'a', title: 'A' }])).toBe(false);
    expect(forward(ev('x'), false)).toBe(false);
  });
  it('sends the list when it changes, and keys when forwardable', () => {
    const sent: [string, unknown][] = [];
    bus.send = (m, p) => void sent.push([m, p]);
    expect(publish([{ id: 'a', title: 'A', key: 'a' }])).toBe(true);
    expect(publish([{ id: 'a', title: 'A', key: 'a' }])).toBe(false);
    expect(publish([{ id: 'a', title: 'A2', key: 'a' }])).toBe(true);
    expect(sent.map(([m]) => m)).toEqual(['zen/commands', 'zen/commands']);
    expect(forward(ev('x'), false)).toBe(true);
    expect(forward(ev('x'), true)).toBe(false);
    expect(sent.at(-1)).toEqual(['zen/key', { key: 'x', code: '', ctrl: false, meta: false, alt: false, shift: false, typing: false }]);
  });
  it('knows which keys are the reader\'s commands', () => {
    bus.keys = new Set(['e', 'Shift+n']);
    expect(owned(ev('e'))).toBe(true);
    expect(owned(ev('N', { shiftKey: true }))).toBe(true);
    expect(owned(ev('ArrowDown'))).toBe(false);
  });
});
