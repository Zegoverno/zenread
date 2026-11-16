// End-to-end in headless Chromium (Playwright) against the built files:
//   1. the PWA (shells/web/dist), loaded with fixture notes through the test hook (?test): the
//      reading aids (width, spacing, bionic, focus, dim, play), headings, the properties, the web link,
//      the changelog, links (wiki, relative, anchors, missing) with a way back, the next note in the
//      folder, settings kept across a reload, a folder opened through the file input, and offline use;
//   2. the MCP App (ui/dist/index.html) in a sandboxed iframe under a minimal test host: handshake, a
//      tool result opens a note, links go through the host in zenbot (zen context) and open in place
//      elsewhere, web links go through the host, settings go to the server, the theme follows the host.
// `node tests/e2e.mjs`   (`SHOTS=/some/dir node tests/e2e.mjs` also writes screenshots there)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'shells/web/dist');
for (const f of [path.join(dist, 'index.html'), path.join(root, 'ui/dist/index.html')]) assert.ok(existsSync(f), `${f} is missing: run npm run build`);
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ---- fixtures: invented, neutral text ----
const para = i => `Paragraph ${i}. The lantern keeper climbed the long stair each evening, counted the steps aloud, and wondered whether the harbour below had ever been quiet. Somewhere a bell answered, and the water kept its own slow time.`;
const filler = n => Array.from({ length: n }, (_, i) => para(i + 1)).join('\n\n');
const NOTES = {
  'index.md': `---\ntitle: Harbour notes\ntags: [sea, stairs]\nsource: https://example.com/harbour\n---\n# Harbour notes\n\nIntro paragraph with a [[Second]] link, a [relative link](sub/Third.md#deep-heading), a [missing one](gone.md), a [[Ghost]], a [web link](https://example.com/page) and a [jump](#later-section).\n\n## First section\n\n${filler(8)}\n\n## Later section\n\n${filler(8)}\n\n## Changelog\n\n- Wrote the intro.\n- Added the sections.\n`,
  'Second.md': '# Second note\n\nBack to [[index]].\n',
  'sub/Third.md': `# Third note\n\n${filler(10)}\n\n## Deep heading\n\nThe target of an anchor link.\n\n${filler(10)}\n`,
  'sub/Fourth.md': '# Fourth note\n',
};
const folder = mkdtempSync(path.join(tmpdir(), 'zenread-e2e-'));
for (const [p, t] of Object.entries({ ...NOTES, '.hidden/secret.md': 'hidden', 'readme.txt': 'not a note' })) {
  mkdirSync(path.dirname(path.join(folder, 'notes', p)), { recursive: true });
  writeFileSync(path.join(folder, 'notes', p), t);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const HOST = `<!doctype html><meta charset=utf-8><title>host</title><body style="margin:0"><iframe id=f sandbox="allow-scripts" style="width:900px;height:700px;border:0"></iframe><script>
window.calls = []; window.contexts = []; window.links = []; window.ready = false; window.docs = window.__docs || {};
const withZen = new URLSearchParams(location.search).has('zen');
const frame = document.getElementById('f');
const reply = (id, result) => frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result }, '*');
const ctx = { theme: 'dark', displayMode: 'inline', ...(withZen ? { zen: { pane: 'board', path: new URLSearchParams(location.search).get('path'), mode: 'read', slot: 'opener' } } : {}) };
let settings = { wpm: 200, pauses: false, width: 72, spaced: false, bionic: false, focus: 'off', dim: 300 };
addEventListener('message', e => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m.method === 'ui/initialize') reply(m.id, { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '0' }, hostCapabilities: { openLinks: {}, updateModelContext: {}, serverTools: {} }, hostContext: ctx });
  else if (m.method === 'ui/notifications/initialized') window.ready = true;
  else if (m.method === 'tools/call') {
    window.calls.push(m.params);
    const { name, arguments: a } = m.params;
    if (name === 'zenread_read') {
      const d = window.docs[a.path];
      reply(m.id, d ? { content: [{ type: 'text', text: d.text }], structuredContent: d } : { isError: true, content: [{ type: 'text', text: 'Not found: ' + a.path }] });
    } else if (name === 'zenread_list') reply(m.id, { content: [{ type: 'text', text: 'list' }], structuredContent: { dir: a.dir ?? '', folders: [], files: Object.keys(window.docs).map(p => ({ name: p, path: p, size: 10, mtime: window.docs[p].mtime ?? 0 })) } });
    else if (name === 'zenread_settings') { if (a.change) settings = { ...settings, ...a.change }; reply(m.id, { content: [{ type: 'text', text: 'ok' }], structuredContent: { settings } }); }
    else reply(m.id, { isError: true, content: [{ type: 'text', text: 'unknown tool' }] });
  }
  else if (m.method === 'ui/update-model-context') { window.contexts.push(m.params); reply(m.id, {}); }
  else if (m.method === 'ui/open-link') { window.links.push(m.params.url); reply(m.id, {}); }
  else if (m.id !== undefined) reply(m.id, {});
});
window.sendContext = zen => frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { zen } }, '*');
window.sendResult = structuredContent => frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'opened' }], structuredContent } }, '*');
fetch('/ui.html').then(r => r.text()).then(html => { frame.srcdoc = html; });
</script>`;

const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  if (url === '/host.html') { res.setHeader('content-type', 'text/html'); return res.end(HOST); }
  const file = url === '/ui.html' ? path.join(root, 'ui/dist/index.html') : path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !existsSync(file)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(r => http.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${http.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const shot = (page, name) => shots ? page.screenshot({ path: path.join(shots, name + '.png') }) : null;
const errors = [];
const watch = page => { page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };

/** The reader's own scroller. */
const scrollTop = scope => scope.locator('.scroll').evaluate(e => e.scrollTop);
const title = scope => scope.locator('.title .name').textContent();

try {
  // =====================  1. the PWA  =====================
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await context.route('https://example.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>example</title>' }));
  const page = await context.newPage();
  watch(page);
  await page.goto(base + '/?test');
  await page.waitForSelector('[data-testid=library]');
  assert.equal(await page.title(), 'zenread');
  assert.match(await page.locator('.start').textContent(), /Open a folder/);
  await shot(page, 'pwa-start');

  // the sample is readable with no folder
  await page.getByRole('button', { name: 'Read the sample' }).click();
  await page.getByRole('button', { name: 'Welcome.md' }).click();
  await page.waitForSelector('[data-testid=reader]');
  assert.equal(await title(page), 'Welcome.md');
  assert.equal(await page.locator('.reader h1').first().textContent(), 'Welcome');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=library]');

  // fixture notes through the test hook
  const open = (p = 'index.md') => page.evaluate(([notes, p]) => window.__zenread.load(notes, p), [NOTES, p]);
  await open();
  await page.waitForSelector('[data-testid=reader]');
  assert.equal(await title(page), 'index.md');
  assert.equal(await page.locator('.reader h1').first().textContent(), 'Harbour notes');
  assert.match(await page.locator('.fm').textContent(), /title: Harbour notes · tags: sea · stairs · source: https:\/\/example\.com\/harbour/);
  await shot(page, 'pwa-reader');

  // width: < > step through 60 72 90 full, and the page measure follows
  const width = () => page.getByTestId('width').textContent();
  const measure = () => page.locator('.scroll > .rpage').evaluate(e => e.style.maxWidth);
  assert.equal(await width(), '72');
  assert.match(await measure(), /72ch/);
  await page.keyboard.press('>');
  assert.equal(await width(), '90');
  assert.match(await measure(), /90ch/);
  await page.keyboard.press('>');
  assert.equal(await width(), 'full');
  assert.equal(await measure(), 'none');
  await page.keyboard.press('<'); await page.keyboard.press('<'); await page.keyboard.press('<');
  assert.equal(await width(), '60');
  await page.keyboard.press('<');
  assert.equal(await width(), '60', 'the narrowest stays');
  const narrow = await page.locator('.scroll > .rpage').evaluate(e => e.getBoundingClientRect().width);
  await page.keyboard.press('>'); await page.keyboard.press('>');
  assert.ok((await page.locator('.scroll > .rpage').evaluate(e => e.getBoundingClientRect().width)) > narrow, 'a wider measure is wider');
  await page.keyboard.press('<'); await page.keyboard.press('<'); // 60 again; kept below

  // spacing, bionic
  const lh = () => page.locator('.reader p').first().evaluate(e => parseFloat(getComputedStyle(e).lineHeight));
  const before = await lh();
  await page.keyboard.press(':');
  assert.ok(await page.locator('.reader.spaced').count());
  assert.ok((await lh()) > before, 'spacing widens the lines');
  await page.keyboard.press(':');
  assert.equal(await page.locator('.reader.spaced').count(), 0);
  assert.equal(await page.locator('b.md-bionic').count(), 0);
  await page.keyboard.press('b');
  assert.ok((await page.locator('b.md-bionic').count()) > 20);
  assert.equal(await page.locator('.reader h1').first().textContent(), 'Harbour notes', 'the text is whole');
  await page.keyboard.press('b');
  assert.equal(await page.locator('b.md-bionic').count(), 0);

  // focus: paragraph, line, off; dim levels
  await page.keyboard.press('f');
  await page.locator('.rpage.focusing .u.lit').waitFor();
  assert.equal(await page.locator('.rpage.focusing .u.lit').count(), 1);
  const keepOf = () => page.locator('.u:not(.lit)').first().evaluate(e => parseFloat(getComputedStyle(e).opacity));
  const k300 = await keepOf();
  await page.keyboard.press('d'); // 500
  assert.match(await page.locator('button[title^="dim level"]').textContent(), /500/);
  await page.waitForTimeout(250);
  assert.ok((await keepOf()) < k300, 'a stronger dim keeps less ink');
  const lit = () => page.locator('.u.lit').evaluate(e => e.textContent.slice(0, 20));
  const first = await lit();
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await lit(), first, 'the arrows move the focus');
  await page.keyboard.press('f');
  await page.locator('.mark').waitFor();
  assert.equal(await page.locator('.mark').count(), 1, 'line focus draws its marker');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelectorAll('.u.lit').length === 0);
  await page.keyboard.press('d'); await page.keyboard.press('d'); await page.keyboard.press('d'); await page.keyboard.press('d'); // back to 300

  // play, word by word
  await page.keyboard.press('p');
  await page.waitForSelector('.player');
  assert.equal(await page.locator('.w.cur').count(), 1);
  assert.match(await page.locator('.pstat').textContent(), /playing · word \d+ of \d+/);
  await page.keyboard.press(' ');
  assert.match(await page.locator('.pstat').textContent(), /paused/);
  const at = async () => Number((await page.locator('.pstat').textContent()).match(/word (\d+) of/)[1]);
  const w0 = await at();
  await page.keyboard.press('ArrowDown');
  assert.equal(await at(), w0 + 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.player').count(), 0);
  assert.equal(await title(page), 'index.md', 'escape stopped the play and left the note open');

  // headings, properties, changelog, the web link
  assert.equal(await scrollTop(page), 0);
  await page.keyboard.press(']');
  const h1 = await scrollTop(page);
  assert.ok(h1 > 0, 'the next heading scrolls');
  await page.keyboard.press(']');
  assert.ok((await scrollTop(page)) > h1);
  await page.keyboard.press('[');
  assert.ok(Math.abs((await scrollTop(page)) - h1) < 3, 'the previous heading comes back');
  await page.keyboard.press('i');
  assert.equal(await page.locator('.fm.open').count(), 1);
  await page.keyboard.press('i');
  assert.equal(await page.locator('.fm.open').count(), 0);
  assert.equal(await page.locator('.reader').getByText('Wrote the intro.').count(), 1);
  assert.ok(await page.locator('.clog.hidden').count(), 'the changelog is apart, hidden at first');
  assert.equal(await page.locator('.scroll .body').getByText('Wrote the intro.').count(), 0, 'and not in the text');
  await page.keyboard.press('h');
  assert.equal(await page.locator('.clog.hidden').count(), 0);
  await page.waitForFunction(() => /changelog · 1–/.test(document.querySelector('.clog-head').textContent));
  await page.keyboard.press('h');
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('Alt+o');
  assert.equal((await popup).url(), 'https://example.com/harbour', 'Alt+O opens the note\'s web link');

  // links: select with l, follow with Enter, back with the left arrow
  await page.keyboard.press('Home');
  await page.keyboard.press('l');
  assert.equal(await page.locator('a.sel').textContent(), 'Second');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'Second.md');
  assert.equal(await page.locator('.reader h1').first().textContent(), 'Second note');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'index.md');
  assert.equal(await page.evaluate(() => window.__zenread.state().back.length), 0);

  // a click on a wiki link; the way back through two notes
  await page.locator('.scroll a', { hasText: 'Second' }).first().click();
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'Second.md');
  await page.locator('.scroll a', { hasText: 'index' }).click(); // [[index]] back by link, case-insensitively
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'index.md');
  assert.equal(await page.evaluate(() => window.__zenread.state().back.length), 2);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.waitForFunction(() => window.__zenread.state().back.length === 0);

  // a relative link with an anchor lands on the heading; a missing link says so; a jump inside the note
  await page.locator('.scroll a', { hasText: 'relative link' }).click();
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'Third.md');
  await page.waitForFunction(() => document.querySelector('.scroll').scrollTop > 100);
  const deep = await page.locator('.scroll h2', { hasText: 'Deep heading' }).evaluate(e => e.getBoundingClientRect().top);
  assert.ok(deep >= 0 && deep < 120, `the anchor's heading is at the top (${deep})`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'index.md');
  await page.locator('.scroll a', { hasText: 'missing one' }).click();
  assert.match(await page.locator('.toast').textContent(), /not found: gone\.md/);
  await page.locator('.scroll a', { hasText: 'Ghost' }).click();
  assert.match(await page.locator('.toast').textContent(), /not found: Ghost/);
  await page.locator('.scroll a', { hasText: 'jump' }).click();
  assert.ok((await scrollTop(page)) > 100, 'an in-note anchor scrolls');
  assert.equal(await title(page), 'index.md');
  const pop2 = page.waitForEvent('popup');
  await page.locator('.scroll a', { hasText: 'web link' }).click();
  assert.equal((await pop2).url(), 'https://example.com/page');

  // the next and previous note in the folder
  assert.ok(await page.getByRole('button', { name: '‹ prev' }).isDisabled());
  await page.keyboard.press('n');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'Second.md');
  assert.ok(await page.getByRole('button', { name: 'next ›' }).isDisabled());
  await page.keyboard.press('N');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'index.md');
  await shot(page, 'pwa-after');

  // settings stay across a reload (localStorage)
  await page.reload();
  await page.waitForSelector('[data-testid=library]');
  await open();
  await page.waitForSelector('[data-testid=reader]');
  assert.equal(await width(), '60');

  // a folder opened through the file input (the fallback every browser has): its notes, folders, no dot folders
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=library]');
  await page.getByRole('button', { name: 'Sample' }).waitFor();
  await page.locator('input[webkitdirectory]').setInputFiles(path.join(folder, 'notes'));
  await page.waitForSelector('.entries');
  assert.deepEqual(await page.locator('.entries .n').allTextContents(), ['sub', 'index.md', 'Second.md']);
  await page.getByRole('button', { name: 'sub' }).click();
  assert.deepEqual(await page.locator('.entries .n').allTextContents(), ['..', 'Fourth.md', 'Third.md']);
  await page.getByRole('button', { name: 'Third.md' }).click();
  await page.waitForSelector('[data-testid=reader]');
  assert.equal(await title(page), 'Third.md');
  await page.locator('.reader h1', { hasText: 'Third note' }).waitFor(); // the note is loaded: its neighbours are known
  await page.keyboard.press('N');
  await page.waitForFunction(() => document.querySelector('.title .name')?.textContent === 'Fourth.md');

  // offline: installable and served by the service worker
  const manifest = await (await page.request.get(base + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length >= 2);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('[data-testid=library]');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid=library]');
  await page.getByRole('button', { name: 'Read the sample' }).click();
  await page.getByRole('button', { name: 'Links.md' }).click();
  assert.equal(await page.locator('.reader h1').first().textContent(), 'Links');
  await context.setOffline(false);
  await context.close();

  // =====================  2. the MCP App  =====================
  const doc = (p, extra = {}) => ({ path: p, name: p.split('/').pop(), text: NOTES[p], size: NOTES[p].length, mtime: 0, prev: null, next: null, resolved: {}, ...extra });
  const indexDoc = doc('index.md', { resolved: { '[[Second]]': 'Second.md', 'sub/Third.md#deep-heading': 'sub/Third.md', '[[Ghost]]': null, 'gone.md': null }, next: 'Second.md' });
  const second = doc('Second.md', { prev: 'index.md', resolved: { '[[index]]': 'index.md' } });
  const third = doc('sub/Third.md');
  const mk = async (query = '') => {
    const p = await browser.newPage({ viewport: { width: 900, height: 760 } });
    watch(p);
    await p.addInitScript(d => { window.__docs = d; }, { 'index.md': indexDoc, 'Second.md': second, 'sub/Third.md': third });
    await p.goto(base + '/host.html' + query);
    await p.waitForFunction(() => window.ready === true);
    return p;
  };

  // in a host that is not zenbot: the agent's result opens the note; links open in place
  const h = await mk();
  const f = h.frameLocator('#f');
  assert.ok(await f.locator('[data-testid=library]').isVisible(), 'the library shows until a note opens');
  await h.evaluate(d => window.sendResult(d), indexDoc);
  await f.locator('[data-testid=reader]').waitFor();
  assert.equal(await title(f), 'index.md');
  assert.equal(await h.evaluate(() => window.calls.filter(c => c.name === 'zenread_read').length), 0, 'the result carried the note: no second read');
  assert.equal(await f.locator('html').getAttribute('data-theme'), 'dark', 'the theme follows the host');
  assert.ok(await h.evaluate(() => window.contexts.some(c => JSON.stringify(c).includes('index.md'))), 'the chat is told which note is open');
  await shot(h, 'app-reader');
  await f.locator('.top').click();
  await h.keyboard.press('>'); // keys go to the frame once it has focus
  assert.equal(await f.getByTestId('width').textContent(), '90');
  await h.waitForFunction(() => window.calls.some(c => c.name === 'zenread_settings' && c.arguments.change?.width === 90), null, { timeout: 4000 }).catch(async e => { console.log(JSON.stringify(await h.evaluate(() => window.calls))); throw e; });
  await f.locator('a', { hasText: 'Second' }).first().click();
  await f.locator('.title .name', { hasText: 'Second.md' }).waitFor();
  assert.deepEqual(await h.evaluate(() => window.calls.filter(c => c.name === 'zenread_read').map(c => c.arguments)), [{ path: 'Second.md' }]);
  assert.deepEqual(await h.evaluate(() => window.links), [], 'no zen link outside zenbot');
  await f.locator('.top').click();
  await h.keyboard.press('ArrowLeft');
  await f.locator('.title .name', { hasText: 'index.md' }).waitFor();
  await f.locator('a', { hasText: 'web link' }).click();
  await h.waitForFunction(() => window.links.join() === 'https://example.com/page'); // web links go through the host
  await h.keyboard.press('Alt+o');
  await h.waitForFunction(() => window.links.at(-1) === 'https://example.com/harbour'); // so does the note's source
  // the note changes on disk (an agent edits it): the reader reads it again, where it was
  await h.evaluate(d => { window.docs['index.md'] = { ...d, text: d.text + '\n\nAdded on disk.\n', mtime: 5 }; }, indexDoc);
  await f.locator('.reader', { hasText: 'Added on disk.' }).waitFor({ timeout: 8000 });
  assert.equal(await title(f), 'index.md');
  await h.close();

  // in zenbot (a zen host context): the opener's path opens, and a note link is handed to the host
  const z = await mk('?zen=1&path=Second.md');
  const zf = z.frameLocator('#f');
  await zf.locator('.title .name', { hasText: 'Second.md' }).waitFor();
  await zf.locator('.scroll a', { hasText: 'index' }).click();
  await z.waitForFunction(() => window.links.includes('zen://open?path=index.md'));
  assert.equal(await title(zf), 'Second.md', 'the host decides where the note opens');
  await z.evaluate(d => window.sendResult(d), indexDoc);
  await zf.locator('.title .name', { hasText: 'index.md' }).waitFor();
  await zf.locator('a', { hasText: 'relative link' }).click();
  await z.waitForFunction(() => window.links.includes('zen://open?path=sub%2FThird.md'));
  assert.equal(await zf.locator('html').getAttribute('data-pane'), 'board', 'the pane is told to the page');
  assert.equal(await zf.locator('html').getAttribute('data-slot'), 'opener');
  // zenbot reuses the iframe for another file: the new path opens, the same path again does not reload it
  const reads = () => z.evaluate(() => window.calls.filter(c => c.name === 'zenread_read').length);
  await z.evaluate(() => window.sendContext({ pane: 'side', path: 'sub/Third.md', mode: 'read', slot: 'opener' }));
  await zf.locator('.title .name', { hasText: 'Third.md' }).waitFor();
  assert.equal(await zf.locator('html').getAttribute('data-pane'), 'side');
  const n = await reads();
  await z.evaluate(() => window.sendContext({ pane: 'side', path: 'sub/Third.md', mode: 'read', slot: 'opener' }));
  await z.waitForTimeout(300);
  assert.equal(await reads(), n, 'an unchanged path is not opened again');
  await z.close();

  assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_/.test(e)), [], 'no page errors');
  console.log('e2e ok: PWA (aids, links, folder, offline) and MCP App (host, zen host)');
} finally {
  await browser.close();
  http.close();
  rmSync(folder, { recursive: true, force: true });
}
