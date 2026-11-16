// MCP smoke test: start the built server (mcp/dist/server.js) over stdio with the SDK client, list
// tools and resources, read the ui:// resource, and call every tool once, with a fixture folder as the
// files root and again without one. `node tests/mcp-smoke.mjs [plugin folder]`: by default this
// repository; tests/pack-smoke.mjs runs it against the unpacked release.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname) + path.sep;
const manifest = JSON.parse(readFileSync(root + 'plugin.json', 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'zenread-smoke-'));
const files = path.join(tmp, 'files'), data = path.join(tmp, 'data'), outside = path.join(tmp, 'outside');
for (const d of [files, data, outside, path.join(files, 'garden'), path.join(files, '.private')]) mkdirSync(d, { recursive: true });
const put = (rel, text) => writeFileSync(path.join(files, rel), text);
put('index.md', '---\ntitle: Index\nsource: https://example.com/index\n---\n# Index\n\nSee [[Soil]] and [plants](garden/plants.md) and [[Ghost]].\n');
put('garden/plants.md', '# Plants\n\nBack to [[index]].\n');
put('garden/Soil.md', '# Soil\n');
put('garden/zeta.md', '# Zeta\n');
put('.private/x.md', 'nope');
writeFileSync(path.join(outside, 'secret.md'), 'secret');
symlinkSync(path.join(outside, 'secret.md'), path.join(files, 'garden/leak.md'));
writeFileSync(path.join(outside, 'y.md'), 'outside');
symlinkSync(outside, path.join(files, 'linked')); // a folder link out

const text = r => r.content.map(c => c.text).join('\n');
const start = env => {
  const client = new Client({ name: 'smoke', version: '0' });
  return client.connect(new StdioClientTransport({ command: manifest.server.command, args: manifest.server.args, cwd: root, env: { PATH: process.env.PATH ?? '', ...env } })).then(() => client);
};

const client = await start({ ZEN_PLUGIN_FILES: files, ZEN_PLUGIN_DATA: data });
try {
  // ---- tools and the manifest ----
  assert.equal(client.getServerVersion().name, manifest.name);
  assert.equal(client.getServerVersion().version, manifest.version, 'the server reports the plugin version');
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, ['zenread_list', 'zenread_open', 'zenread_read', 'zenread_settings']);
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  assert.equal(byName.zenread_open._meta.ui.resourceUri, 'ui://zenread/app');
  assert.deepEqual(byName.zenread_settings._meta.ui.visibility, ['app']);
  assert.equal(manifest.contributes.commands[0].tool, 'zenread_open');
  assert.ok(names.includes(manifest.contributes.commands[0].tool));
  assert.deepEqual(manifest.contributes.openers[0], { id: 'read', title: 'Read', ui: 'ui://zenread/app', patterns: ['*.md'], mode: 'read' });
  assert.deepEqual(manifest.kernel, ['files:read']);
  assert.equal(manifest.contributes.views, undefined, 'Files opener only: no Reading tab');
  assert.deepEqual(Object.keys(manifest.contributes).sort(), ['commands', 'openers']);

  // ---- the resource ----
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map(r => r.uri), ['ui://zenread/app']);
  assert.equal(resources[0].mimeType, 'text/html;profile=mcp-app');
  const ui = await client.readResource({ uri: 'ui://zenread/app' });
  assert.equal(ui.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(ui.contents[0].text, /<html[\s\S]*<\/html>\s*$/i);
  assert.ok(ui.contents[0].text.length > 50_000, 'the UI is one self-contained file');
  assert.doesNotMatch(ui.contents[0].text, /<script[^>]+src=|<link[^>]+href=/i, 'no external files');

  // ---- zenread_list ----
  const root_ = await client.callTool({ name: 'zenread_list', arguments: {} });
  assert.ok(!root_.isError);
  assert.deepEqual(root_.structuredContent.folders.map(f => f.path), ['garden']);
  assert.deepEqual(root_.structuredContent.files.map(f => f.path), ['index.md']);
  const garden = await client.callTool({ name: 'zenread_list', arguments: { dir: 'garden' } });
  assert.deepEqual(garden.structuredContent.files.map(f => f.path), ['garden/plants.md', 'garden/Soil.md', 'garden/zeta.md']); // the link out is not listed
  assert.match(text(garden), /garden\/plants\.md/);

  // ---- zenread_read ----
  const read = await client.callTool({ name: 'zenread_read', arguments: { path: 'garden/plants.md' } });
  assert.ok(!read.isError);
  assert.equal(text(read), '# Plants\n\nBack to [[index]].\n');
  assert.equal(read.structuredContent.prev, null);
  assert.equal(read.structuredContent.next, 'garden/Soil.md');
  assert.deepEqual(read.structuredContent.resolved, { '[[index]]': 'index.md' });
  const index = (await client.callTool({ name: 'zenread_read', arguments: { path: 'index.md' } })).structuredContent;
  assert.equal(index.frontMatter, 'title: Index\nsource: https://example.com/index');
  assert.deepEqual(index.properties, [['title', 'Index'], ['source', 'https://example.com/index']]);
  assert.equal(index.source, 'https://example.com/index');
  assert.deepEqual(index.resolved, { '[[Soil]]': 'garden/Soil.md', 'garden/plants.md': 'garden/plants.md', '[[Ghost]]': null });

  // ---- zenread_open: shows the UI and carries the note for it ----
  const open = await client.callTool({ name: 'zenread_open', arguments: { path: 'garden/Soil.md' } });
  assert.ok(!open.isError);
  assert.equal(open.structuredContent.path, 'garden/Soil.md');
  assert.equal(open.structuredContent.text, '# Soil\n');
  assert.equal(open.structuredContent.prev, 'garden/plants.md');
  assert.equal(open.structuredContent.next, 'garden/zeta.md');
  assert.match(text(open), /Opened garden\/Soil\.md/);

  // ---- refusals ----
  for (const p of ['../outside/secret.md', '/etc/hostname.md', path.join(files, 'index.md'), '.private/x.md', 'garden/leak.md', 'linked/y.md', 'garden/missing.md', 'garden', 'index.txt']) {
    for (const name of ['zenread_read', 'zenread_open']) {
      const r = await client.callTool({ name, arguments: { path: p } });
      assert.equal(r.isError, true, `${name} ${p}`);
      assert.doesNotMatch(text(r), /secret$|nope/);
    }
  }
  assert.equal((await client.callTool({ name: 'zenread_list', arguments: { dir: '..' } })).isError, true);
  assert.equal((await client.callTool({ name: 'zenread_list', arguments: { dir: '.private' } })).isError, true);
  assert.equal((await client.callTool({ name: 'zenread_list', arguments: { dir: 'linked' } })).isError, true, 'a folder link out is refused');
  assert.ok(!(await client.callTool({ name: 'zenread_list', arguments: {} })).structuredContent.folders.some(f => f.name === 'linked'), 'and not listed');

  // ---- zenread_settings: kept in the data folder across restarts ----
  const first = await client.callTool({ name: 'zenread_settings', arguments: {} });
  assert.equal(first.structuredContent.settings.width, 72);
  const changed = await client.callTool({ name: 'zenread_settings', arguments: { change: { width: 90, bionic: true, dim: 12, bogus: 1 } } });
  assert.equal(changed.structuredContent.settings.width, 90);
  assert.equal(changed.structuredContent.settings.bionic, true);
  assert.equal(changed.structuredContent.settings.dim, 300, 'an invalid value is ignored');
  assert.equal(JSON.parse(readFileSync(path.join(data, 'settings.json'), 'utf8')).width, 90);
} finally {
  await client.close();
}

// ---- a restart reads the settings back ----
const again = await start({ ZEN_PLUGIN_FILES: files, ZEN_PLUGIN_DATA: data });
try {
  assert.equal((await again.callTool({ name: 'zenread_settings', arguments: {} })).structuredContent.settings.width, 90);
} finally { await again.close(); }

// ---- a files folder that is not absolute: refused clearly ----
const rel = await start({ ZEN_PLUGIN_FILES: 'files' });
try {
  const r = await rel.callTool({ name: 'zenread_list', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /absolute/);
} finally { await rel.close(); }

// ---- no files folder (as in Claude Desktop): file tools say so, the UI still loads ----
const bare = await start({});
try {
  for (const [name, args] of [['zenread_list', {}], ['zenread_read', { path: 'index.md' }], ['zenread_open', { path: 'index.md' }]]) {
    const r = await bare.callTool({ name, arguments: args });
    assert.equal(r.isError, true, name);
    assert.match(text(r), /ZEN_PLUGIN_FILES/);
  }
  assert.ok((await bare.readResource({ uri: 'ui://zenread/app' })).contents[0].text.length > 50_000);
  assert.ok(!(await bare.callTool({ name: 'zenread_settings', arguments: {} })).isError);
} finally { await bare.close(); rmSync(tmp, { recursive: true, force: true }); }

console.log(`mcp smoke ok: ${4} tools, 1 resource, no-files mode`);
