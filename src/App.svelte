<script lang="ts">
  // The game UI by default. The old debug screen stays reachable at #debug as a diagnostics page;
  // it loads lazily, so it (and the Trystero it imports) stays out of the main chunk.
  import TrioApp from './ui/TrioApp.svelte';

  const debug = location.hash.toLowerCase() === '#debug';
</script>

{#if debug}
  {#await import('./debug/DebugScreen.svelte') then module}
    <module.default />
  {/await}
{:else}
  <TrioApp />
{/if}
