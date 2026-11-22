<script lang="ts">
  // The page: the reader when a note is open, else the library (the folder's notes, or where to start).
  import type { Env } from './adapters.ts';
  import Library from './Library.svelte';
  import Reader from './Reader.svelte';
  import type { Store } from './store.svelte.ts';
  import { zen } from './zen.svelte.ts';
  import { forward, isTyping } from './zenkeys.ts';

  let { store, env }: { store: Store; env: Env } = $props();

  // No note open (zenbot's file list is in front): the Reader is not there to forward the keys, so the page does.
  const onkeydown = (e: KeyboardEvent) => {
    if (zen.active && !store.path) forward(e, isTyping(e));
  };
</script>

<svelte:window {onkeydown} />

<div class="app">
  {#if store.path}
    <Reader {store} {env} />
  {:else if !env.standalone}
    <p class="host-prompt">Open a note from your host’s files to read it here.</p>
  {:else}
    <Library {store} {env} />
  {/if}
  {#if store.toast}<div class="toast" role="status">{store.toast}</div>{/if}
</div>

<style>
  .app { height: max(560px, 100dvh); position: relative; }
  :global(:root[data-zen]) .app { height: 100dvh; }
  .toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: calc(100% - 32px); padding: 7px 14px; border-radius: 8px; background: var(--ink); color: var(--paper); font: 13px var(--sans); box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); z-index: 5; }
</style>
