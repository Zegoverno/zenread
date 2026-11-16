<script lang="ts">
  // The page: the reader when a note is open, else the library (the folder's notes, or where to start).
  import type { Env } from './adapters.ts';
  import Library from './Library.svelte';
  import Reader from './Reader.svelte';
  import type { Store } from './store.svelte.ts';

  let { store, env }: { store: Store; env: Env } = $props();
</script>

<div class="app">
  {#if store.path}
    <Reader {store} {env} />
  {:else}
    <Library {store} {env} />
  {/if}
  {#if store.toast}<div class="toast" role="status">{store.toast}</div>{/if}
</div>

<style>
  .app { height: max(560px, 100dvh); position: relative; }
  .toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: calc(100% - 32px); padding: 7px 14px; border-radius: 8px; background: var(--ink); color: var(--paper); font: 13px var(--sans); box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); z-index: 5; }
</style>
