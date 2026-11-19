// The MCP App entry: the same reader inside a host (zenbot, Claude, ChatGPT, …).
// Built as one HTML file (vite.app.config.ts) and served by mcp/ as ui://zenread/app.
//
// - Notes come from this server's tools (zenread_read, zenread_list) through app.callServerTool.
// - A tool result from the agent (zenread_open) opens its note at once, with no second call.
// - Settings live in the server's data folder (zenread_settings): an iframe may have no localStorage.
// - In zenbot (the host context has a `zen` key) a link to another note is handed to the host with
//   app.openLink('zen://open?path=…'); elsewhere it opens inside the reader. Web links always go
//   through app.openLink.
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mount } from 'svelte';
import './app.css';
import type { Env, HostAdapter, Listing, NoteDoc, SettingsAdapter, Source } from './adapters.ts';
import App_ from './App.svelte';
import { createStore } from './store.svelte.ts';
import { DEFAULTS, normalize } from '../core/settings.ts';
import { taskUrl } from '../core/tasks.ts';
import { VERSION } from '../core/version.ts';
import { applyZen, zenOf } from './zen.svelte.ts';

const app = new App({ name: 'zenread', version: VERSION });

const textOf = (r: CallToolResult) => r.content?.map((c) => (c.type === 'text' ? c.text : '')).join('\n').trim() || 'The reader could not do that.';

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error(textOf(r));
  return (r.structuredContent ?? {}) as Record<string, unknown>;
}

const isDoc = (v: unknown): v is NoteDoc => {
  const d = v as Partial<NoteDoc> | undefined;
  return !!d && typeof d.path === 'string' && typeof d.text === 'string' && typeof d.resolved === 'object';
};

/** Reads through the plugin's tools; a note an agent opened arrives with the tool result and is kept for the first read. */
function hostSource() {
  const primed = new Map<string, NoteDoc>();
  const source: Source = {
    label: 'Notes',
    live: true,
    async read(path) {
      const hit = primed.get(path);
      if (hit) {
        primed.delete(path);
        return hit;
      }
      const d = await call('zenread_read', { path });
      if (!isDoc(d)) throw new Error('The server sent an unexpected answer.');
      return d;
    },
    async list(dir) {
      return (await call('zenread_list', dir ? { dir } : {})) as unknown as Listing;
    },
  };
  return { source, prime: (d: NoteDoc) => primed.set(d.path, d) };
}

const settings: SettingsAdapter = {
  async load() {
    try {
      return normalize((await call('zenread_settings', {})).settings);
    } catch {
      return { ...DEFAULTS };
    }
  },
  async save(s) {
    await call('zenread_settings', { change: s });
  },
};

const zenHost = () => zenOf(app.getHostContext());
const host: HostAdapter = {
  close() {
    if (zenHost()?.slot !== "opener") return false;
    app.openLink({ url: "zen://close" }).catch(() => {});
    return true;
  },
  get editNote() {
    if (!zenHost()) return undefined;
    return (path: string) => {
      app.openLink({ url: `zen://open?path=${encodeURIComponent(path)}&mode=edit` }).catch(() => {});
    };
  },
  get setTask() {
    if (!zenHost()) return undefined;
    return async (id: string, done: boolean) => !(await app.openLink({ url: taskUrl(id, done) })).isError;
  },
  openWeb(url) {
    app.openLink({ url }).catch(() => {});
  },
  async openNote(path) {
    if (!zenHost()) return false;
    const r = await app.openLink({ url: `zen://open?path=${encodeURIComponent(path)}` });
    return !r.isError;
  },
};

const { source, prime } = hostSource();
const env: Env = { source, settings, host, standalone: false };
const store = createStore(env);

let mirrored = '';
store.onOpen = (path) => {
  if (path === mirrored) return;
  mirrored = path;
  app.updateModelContext({ content: [{ type: 'text', text: `The user has the note "${path}" open in the reader.` }] }).catch(() => {});
};

/** Theme and styles; zenbot's pane and slot; and, when the host says which note to show, that note.
 *  `asked` is true for a context change that carries `zen` (a change holds only what changed), and for the first context. */
function applyContext(ctx: McpUiHostContext | undefined, asked = true) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  const z = zenOf(ctx);
  // zenbot draws the shell: tell the page where the reader sits (board or side panel), why it was opened,
  // how big the pane is, its title font and whether it is a phone.
  applyZen(ctx);
  // The opener hands over the file's path; a new one while the page lives (the iframe reused) opens it.
  if (asked && typeof z?.path === 'string' && z.path && z.path !== store.path) store.open(z.path, { fresh: true });
}

app.ontoolresult = (result) => {
  if (result.isError) return store.notice(textOf(result as CallToolResult));
  const sc = result.structuredContent;
  if (!isDoc(sc)) return;
  prime(sc);
  store.open(sc.path, { fresh: true });
};
// Mount once the handshake is done: tools can only be called after it.
app.onhostcontextchanged = (changed) => applyContext(app.getHostContext(), 'zen' in (changed ?? {}));
await app.connect();
applyContext(app.getHostContext()); // theme, pane, and the opener's path
await store.init().catch(() => {});
mount(App_, { target: document.getElementById('app')!, props: { store, env } });
