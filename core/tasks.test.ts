import { describe, expect, it } from 'vitest';
import { taskId, taskIdIn, taskUrl } from './tasks.ts';

describe('task ids', () => {
  it('uses the 🆔 of the line when it has one', () => {
    expect(taskIdIn('- [ ] Pay the rent 🆔 rent-7 📅 2026-12-01')).toBe('rent-7');
    expect(taskIdIn('- [ ] No id here')).toBeNull();
    expect(taskId('a/b.md', 3, 'rent-7')).toBe('rent-7');
  });
  it('else names the line: L:<path>:<line>', () => {
    expect(taskId('journal/2026-11-19.md', 12)).toBe('L:journal/2026-11-19.md:12');
    expect(taskId('x.md', 1, null)).toBe('L:x.md:1');
  });
  it('asks the host with an encoded id and 1 or 0', () => {
    expect(taskUrl('L:a b/c.md:4', true)).toBe('zen://task?id=L%3Aa%20b%2Fc.md%3A4&done=1');
    expect(taskUrl('rent-7', false)).toBe('zen://task?id=rent-7&done=0');
    const u = new URL(taskUrl('L:a b/c.md:4', true));
    expect(u.searchParams.get('id')).toBe('L:a b/c.md:4');
  });
});
