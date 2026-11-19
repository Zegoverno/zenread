// The reader's MCP server: tools for an agent, one for the app, and the app's HTML resource.
//
//   zenread_open      open a note in the reader (shows the UI); the result carries the note for the UI
//   zenread_read      a note's Markdown, front matter, neighbours (the .md files before and after it in
//                    its folder) and where its links point
//   zenread_list      the Markdown notes and folders in a folder
//   zenread_backlinks the notes that link to a note ("Linked from")
//   zenread_settings  app only: the reading aids' settings, kept in the plugin's data folder
//
// Files are read-only and confined to ZEN_PLUGIN_FILES (see files.ts). Without it, file tools say so.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { resolveAll } from '../core/links.ts';
import { DEFAULTS, normalize } from '../core/settings.ts';
import type { ReaderSettings } from '../core/settings.ts';
import { VERSION } from '../core/version.ts';
import { countWords, properties, sourceLink, splitFront } from '../core/text.ts';
import { Backlinks } from './backlinks.ts';
import { FileError, Files } from './files.ts';

export const UI_URI = 'ui://zenread/app';
const UI_META = { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } };

const reply = (message: string, structured: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: message }], structuredContent: structured });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });
const NO_FILES = 'No files folder is set: this server reads notes from the folder in ZEN_PLUGIN_FILES, which the host (zenbot) sets. To read local files, use the standalone app (the PWA) instead.';

export interface Options {
  /** The folder notes are read from; default ZEN_PLUGIN_FILES. */
  filesRoot?: string | null;
  /** Where settings are kept; default ZEN_PLUGIN_DATA (memory only when absent). */
  dataDir?: string | null;
  /** The built UI; default ui/dist/index.html next to this server's build. */
  loadHtml?: () => string;
}

/** Settings in `dir/settings.json`, or only in memory without a folder. */
export function settingsStore(dir: string | null) {
  let held: ReaderSettings | null = null;
  const file = dir ? path.join(dir, 'settings.json') : null;
  const load = (): ReaderSettings => {
    if (held) return held;
    let raw: unknown = null;
    if (file) try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet, or unreadable: defaults */ }
    return (held = normalize(raw));
  };
  return {
    get: load,
    set(change: unknown): ReaderSettings {
      held = normalize(change, load());
      if (file) {
        try {
          mkdirSync(dir!, { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          writeFileSync(tmp, JSON.stringify(held, null, 2) + '\n');
          renameSync(tmp, file);
        } catch { /* the data folder is not writable: kept in memory */ }
      }
      return held;
    },
  };
}

export function createServer(opts: Options = {}): McpServer {
  const root = opts.filesRoot === undefined ? process.env.ZEN_PLUGIN_FILES || null : opts.filesRoot;
  const dataDir = opts.dataDir === undefined ? process.env.ZEN_PLUGIN_DATA || null : opts.dataDir;
  const loadHtml = opts.loadHtml ?? defaultHtml;
  let files: Files | null = null;
  let rootError = '';
  if (root) try { files = new Files(root); } catch (e) { rootError = (e as Error).message; }
  const backlinks = files ? new Backlinks(files) : null;
  const settings = settingsStore(dataDir);

  const server = new McpServer({ name: 'zenread', version: VERSION });

  /** A note with everything the UI needs: front matter, the next and previous note, link targets. */
  async function note(rel: unknown) {
    const f = await files!.read(rel);
    const { front, body } = splitFront(f.text);
    const props = front ? properties(front) : [];
    const resolved = resolveAll(f.path, body, await files!.index());
    return {
      path: f.path, name: f.path.split('/').pop()!, text: f.text, frontMatter: front, properties: props, source: sourceLink(props),
      words: countWords(body), size: f.size, mtime: f.mtime, prev: f.prev, next: f.next, resolved,
    };
  }
  const guard = async <T>(fn: () => Promise<T>) => {
    if (!files) return fail(rootError || NO_FILES) as never;
    try { return await fn(); } catch (e) {
      if (e instanceof FileError) return fail(e.message) as never;
      if ((e as NodeJS.ErrnoException).code === 'EACCES') return fail('That file cannot be read (permission denied).') as never;
      return fail('That could not be read.') as never;
    }
  };

  registerAppResource(server, 'zenread', UI_URI, {
    description: 'A calm Markdown reader: width, spacing, bionic reading, focus, play, links and headings.',
    _meta: { ui: UI_META },
  }, async () => ({
    contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: loadHtml(), _meta: { ui: UI_META } }],
  }));

  registerAppTool(server, 'zenread_open', {
    title: 'Open a note',
    description: 'Open a Markdown note (.md) in the reader and show it to the user. `path` is relative to the files folder. The user can then use the reading aids, follow links and move to the next note in the folder.',
    inputSchema: { path: z.string().max(1000).describe('Path of the note, relative to the files folder, e.g. "essays/idea.md".') },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: UI_URI } },
  }, async ({ path: p }) => guard(async () => {
    const n = await note(p);
    return reply(`Opened ${n.path} in the reader (${n.words} words${n.next ? `; next in the folder: ${n.next}` : ''}).`, n);
  }));

  server.registerTool('zenread_read', {
    title: 'Read a note',
    description: 'A Markdown note\'s text, with its front matter (raw and as properties), its web link when the front matter has one (link, url or source), its neighbours (the notes before and after it in its folder) and where each [[wiki link]] and relative .md link points (null when the note is not found). `path` is relative to the files folder.',
    inputSchema: { path: z.string().max(1000).describe('Path of the note, relative to the files folder.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path: p }) => guard(async () => {
    const n = await note(p);
    return reply(n.text, n);
  }));

  server.registerTool('zenread_list', {
    title: 'List notes',
    description: 'The Markdown notes (.md) and the folders in a folder, in reading order. `dir` is relative to the files folder; omit it for the root. Hidden entries (starting with a dot) are never listed.',
    inputSchema: { dir: z.string().max(1000).optional().describe('Folder, relative to the files folder; omit for the root.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ dir }) => guard(async () => {
    const l = await files!.list(dir ?? '');
    const lines = [...l.folders.map((f) => `${f.path}/`), ...l.files.map((f) => f.path)];
    return reply(`${l.dir || '(root)'}: ${l.folders.length} folder(s), ${l.files.length} note(s)${l.truncated ? ' (list cut short)' : ''}\n${lines.join('\n')}`, { ...l });
  }));

  server.registerTool('zenread_backlinks', {
    title: 'Linked from',
    description: 'The notes that link to a note: a [[wiki link]] written as its file name or its title, or a relative .md link, found by reading every note in the files folder. Returns `backlinks`, a list of {path, title}, by title. `path` is relative to the files folder.',
    inputSchema: { path: z.string().max(1000).describe('Path of the note, relative to the files folder.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path: p }) => guard(async () => {
    const f = await files!.text(p);
    const list = await backlinks!.to(f.path);
    return reply(list.length ? `${list.length} note(s) link to ${f.path}:\n${list.map((b) => `${b.path} (${b.title})`).join('\n')}` : `No note links to ${f.path}.`, { path: f.path, backlinks: list });
  }));

  registerAppTool(server, 'zenread_settings', {
    title: 'Reader settings',
    description: 'For the app only: read the reading aids\' settings (width, spacing, bionic, focus, dim, play speed), or change some of them. Kept in the plugin\'s data folder.',
    inputSchema: { change: z.record(z.string(), z.unknown()).optional().describe('Settings to change; omit to just read them.') },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] } },
  }, async ({ change }) => {
    const s = change ? settings.set(change) : settings.get();
    return reply(JSON.stringify(s), { settings: s, defaults: DEFAULTS });
  });

  return server;
}

function defaultHtml(): string {
  try { return readFileSync(new URL('../../ui/dist/index.html', import.meta.url), 'utf8'); }
  catch { throw new Error('The reader UI is not built. Run `npm run build` in the plugin folder.'); }
}
