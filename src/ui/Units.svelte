<script lang="ts">
  // Text whose seconds unit stays a lowercase "s", even inside uppercase labels.
  import { splitUnits } from '../game/format.ts';

  let { text }: { text: string } = $props();
  const parts = $derived(splitUnits(text));
</script>

{#each parts as part, i (i)}{#if part.unit}<span class="unit">s</span>{:else}{part.text}{/if}{/each}
