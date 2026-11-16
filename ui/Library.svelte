<script lang="ts">
  // The start page and the folder browser: the notes and folders of the source, and (standalone)
  // the ways to open a folder or files from this device, or the sample.
  import { canPickFolder, fileListSource, memorySource, pickFolder } from './adapters.ts';
  import type { Env, Listing } from './adapters.ts';
  import { SAMPLE } from './sample.ts';
  import type { Store } from './store.svelte.ts';

  let { store, env }: { store: Store; env: Env } = $props();

  let listing = $state<Listing | null>(null);
  let error = $state('');
  let loading = $state(false);
  let folderInput = $state<HTMLInputElement>();
  let filesInput = $state<HTMLInputElement>();
  let seq = 0;

  $effect(() => {
    const src = store.source;
    const dir = store.dir;
    listing = null;
    error = '';
    if (!src) return;
    const n = ++seq;
    loading = true;
    src.list(dir).then(
      (l) => { if (n === seq) { listing = l; loading = false; } },
      (e) => { if (n === seq) { error = (e as Error).message; loading = false; } },
    );
  });

  async function openFolder() {
    try {
      if (canPickFolder()) {
        const s = await pickFolder();
        if (s) store.setSource(s);
      } else folderInput?.click();
    } catch (e) {
      store.notice(`could not open the folder: ${(e as Error).message}`);
    }
  }
  function picked(e: Event, input: HTMLInputElement | undefined) {
    const list = (e.target as HTMLInputElement).files;
    if (list?.length) store.setSource(fileListSource(list));
    if (input) input.value = '';
  }
  const sample = () => store.setSource(memorySource('Sample', SAMPLE));
  const up = () => (store.dir = store.dir.includes('/') ? store.dir.slice(0, store.dir.lastIndexOf('/')) : '');
  const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const empty = $derived(!!listing && !listing.folders.length && !listing.files.length);
</script>

<div class="library" data-testid="library">
  <header>
    <h1>Reading</h1>
    {#if env.standalone}
      <div class="actions">
        <button onclick={openFolder}>Open folder</button>
        <button onclick={() => filesInput?.click()}>Open files</button>
        {#if store.source}<button onclick={sample}>Sample</button>{/if}
      </div>
    {/if}
  </header>

  {#if !store.source}
    <section class="start">
      <p class="lead">A calm reader for Markdown notes.</p>
      <p>Open a folder of <code>.md</code> files from this device, or try the sample. Everything is read in this browser; nothing is uploaded.</p>
      <div class="actions big">
        <button class="primary" onclick={openFolder}>Open a folder</button>
        <button onclick={() => filesInput?.click()}>Open files</button>
        <button onclick={sample}>Read the sample</button>
      </div>
    </section>
  {:else}
    <nav class="crumb" aria-label="folder">
      <button onclick={() => (store.dir = "")}>{store.label}</button>
      {#each store.dir.split('/').filter(Boolean) as part, i}
        <span class="dim">/</span>
        <button onclick={() => (store.dir = store.dir.split('/').slice(0, i + 1).join('/'))}>{part}</button>
      {/each}
    </nav>
    {#if loading && !listing}
      <p class="msg dim">reading the folder…</p>
    {:else if error}
      <p class="msg err">{error}</p>
    {:else if listing}
      <ul class="entries">
        {#if store.dir}<li><button class="entry" onclick={up}><span class="icon">↰</span><span class="n">..</span></button></li>{/if}
        {#each listing.folders as f}
          <li><button class="entry" onclick={() => (store.dir = f.path)}><span class="icon">▸</span><span class="n">{f.name}</span></button></li>
        {/each}
        {#each listing.files as f}
          <li><button class="entry note" onclick={() => store.open(f.path, { fresh: true })}><span class="icon">¶</span><span class="n">{f.name}</span><span class="dim size">{kb(f.size)}</span></button></li>
        {/each}
      </ul>
      {#if empty}<p class="msg dim">No Markdown notes in this folder.</p>{/if}
      {#if listing.truncated}<p class="msg dim">The list was cut short.</p>{/if}
    {/if}
  {/if}

  <input bind:this={folderInput} type="file" hidden multiple webkitdirectory onchange={(e) => picked(e, folderInput)} />
  <input bind:this={filesInput} type="file" hidden multiple accept=".md,.markdown,text/markdown" onchange={(e) => picked(e, filesInput)} />
</div>

<style>
  .library { height: 100%; overflow: auto; max-width: 46rem; margin: 0 auto; padding: 18px 20px 40px; font-family: var(--sans); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h1 { font-family: var(--serif); font-size: 1.5rem; margin: 0 0 12px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .actions button { padding: 4px 11px; border: 1px solid var(--faint); border-radius: 6px; color: var(--ink); }
  .actions button:hover { border-color: var(--accent); color: var(--accent); }
  .actions.big { margin-top: 18px; }
  .actions.big button { padding: 8px 16px; font-size: 15px; }
  .actions .primary { background: var(--accent); color: var(--paper); border-color: var(--accent); }
  .actions .primary:hover { color: var(--paper); opacity: 0.9; }
  .start { padding-top: 6vh; line-height: 1.6; }
  .lead { font-family: var(--serif); font-size: 1.25rem; margin: 0 0 8px; }
  .crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0 10px; font-size: 13px; }
  .crumb button { color: var(--accent); }
  .entries { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--faint); }
  .entries li { border-bottom: 1px solid var(--faint); }
  .entry { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 9px 4px; text-align: left; cursor: pointer; }
  .entry:hover { background: color-mix(in srgb, var(--faint) 35%, transparent); }
  .icon { width: 1.2em; color: var(--dim); text-align: center; }
  .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note .n { font-family: var(--serif); font-size: 1.05rem; }
  .size { font-size: 12px; }
  .msg { padding: 18px 4px; margin: 0; }
  .err { color: var(--err); }
  code { font-family: var(--mono); font-size: 0.9em; }
</style>
