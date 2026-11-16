// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from './md.ts';

const html = (md: string) => render(md).el;

describe('render', () => {
  it('hands back the front matter and leaves it out of the text', () => {
    const r = render('---\ntitle: A\n---\n# Head\n\nBody.');
    expect(r.front).toBe('title: A');
    expect(r.el.querySelector('h1')?.textContent).toBe('Head');
    expect(r.el.textContent).not.toContain('title');
  });

  it('draws headings, emphasis, lists, quotes, code, rules and tables', () => {
    const el = html('## Two\n\nSome *em*, **strong**, ~~gone~~ and `code`.\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo\n\n> quoted\n\n```js\nlet a = 1;\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(el.querySelector('h2')?.textContent).toBe('Two');
    expect(el.querySelector('em')?.textContent).toBe('em');
    expect(el.querySelector('strong')?.textContent).toBe('strong');
    expect(el.querySelector('del')?.textContent).toBe('gone');
    expect(el.querySelector('p code')?.textContent).toBe('code');
    expect(el.querySelectorAll('ol li')).toHaveLength(2);
    expect(el.querySelectorAll('li.md-task')).toHaveLength(2);
    expect(el.querySelectorAll('li.md-done')).toHaveLength(1);
    expect(el.querySelector('blockquote')?.textContent).toContain('quoted');
    expect(el.querySelector('pre code')?.textContent).toBe('let a = 1;');
    expect(el.querySelector('hr')).toBeTruthy();
    expect([...el.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['a', 'b']);
    expect([...el.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['1', '2']);
  });

  it('opens web links in a new tab and gives the others to the caller', () => {
    const el = html('[web](https://example.com/x) [rel](sub/Note.md#top) [[Wiki page|label]] <https://example.com/auto>');
    const [web, rel, wiki, auto] = [...el.querySelectorAll('a')];
    expect(web.href).toBe('https://example.com/x');
    expect(web.target).toBe('_blank');
    expect(web.rel).toContain('noopener');
    expect(rel.dataset.href).toBe('sub/Note.md#top');
    expect(rel.getAttribute('href')).toBe('#');
    expect(wiki.dataset.wiki).toBe('Wiki page');
    expect(wiki.textContent).toBe('label');
    expect(auto.href).toBe('https://example.com/auto');
  });

  it('never turns text into markup or requests', () => {
    const el = html('<script>window.hacked = 1</script>\n\nText <img src=x onerror="window.hacked=1"> and ![alt text](https://example.com/p.png) and [js](javascript:alert(1)).\n\n<!-- hidden -->');
    expect(el.querySelector('script, img')).toBeNull();
    expect(el.textContent).toContain('<script>');
    expect(el.textContent).not.toContain('hidden');
    expect(el.querySelector('a.md-image')?.textContent).toBe('🖼 alt text');
    const js = [...el.querySelectorAll('a')].find((a) => a.textContent === 'js')!;
    expect(js.getAttribute('href')).toBe('#'); // not a web link: never navigates
    expect(js.dataset.href).toBe('javascript:alert(1)');
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('draws callouts and shows math as its source', () => {
    const el = html('> [!warning] Careful\n> Mind the gap.\n\nInline $a^2$ and\n\n$$\nx = 1\n$$\n');
    expect(el.querySelector('.md-callout-warning .md-callout-title')?.textContent).toBe('Careful');
    expect(el.querySelector('.md-callout')?.textContent).toContain('Mind the gap.');
    expect(el.querySelector('span.md-math')?.textContent).toBe('a^2');
    expect(el.querySelector('div.md-display')?.textContent).toBe('x = 1');
  });
});
