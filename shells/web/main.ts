// The PWA entry: the reader with browser storage, a folder (or files) opened from the device, and a
// service worker for offline use.
import { mount } from 'svelte';
import '../../ui/app.css';
import { fileListSource, localSettings, memorySource } from '../../ui/adapters.ts';
import type { Env } from '../../ui/adapters.ts';
import App from '../../ui/App.svelte';
import { createStore } from '../../ui/store.svelte.ts';

const env: Env = {
  source: null,
  settings: localSettings(),
  host: { openWeb: (url) => void window.open(url, '_blank', 'noopener,noreferrer') },
  standalone: true,
};
const store = createStore(env);
await store.init();
mount(App, { target: document.getElementById('app')!, props: { store, env } });

// Installed as an app, a Markdown file opened with it (where the system allows) is read at once.
const queue = (globalThis as { launchQueue?: { setConsumer(f: (p: { files: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue;
queue?.setConsumer(async (params) => {
  try {
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    if (!files.length) return;
    store.setSource(fileListSource(files));
    store.open(files[0].name, { fresh: true });
  } catch { /* the file could not be read: stay on the start page */ }
});

// A test hook (only with ?test in the address): load notes held in memory, optionally open one.
if (new URLSearchParams(location.search).has('test')) {
  (window as unknown as Record<string, unknown>).__zenread = {
    load(notes: Record<string, string>, open?: string) {
      store.setSource(memorySource('Fixture', notes));
      if (open) store.open(open, { fresh: true });
    },
    state: () => ({ path: store.path, back: [...store.back], settings: { ...store.settings } }),
  };
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
