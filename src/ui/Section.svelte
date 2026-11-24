<script lang="ts">
  // A collapsible slab with a big title (the lobby's "What's a set?" and "How to play").
  import type { Snippet } from 'svelte';
  import { play } from '../lib/audio/index.ts';
  import PixelIcon from './PixelIcon.svelte';

  interface Props {
    id: string;
    title: string;
    open?: boolean;
    children: Snippet;
  }

  let { id, title, open = $bindable(false), children }: Props = $props();

  function toggle(): void {
    open = !open;
    play('ui');
  }
</script>

<section class="slab learn" aria-labelledby="{id}-t">
  <h2 class="learn-h">
    <button id="{id}-t" class="learn-toggle" type="button" aria-expanded={open} aria-controls="{id}-b" onclick={toggle}>
      <span class="learn-title">{title}</span>
      <span class="chev" class:open><PixelIcon name="chevron" size={0.5} /></span>
    </button>
  </h2>
  <div id="{id}-b" class="learn-body" hidden={!open}>
    {@render children()}
  </div>
</section>

<style>
  .learn-h {
    margin: 0;
  }
  .learn-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--ink-dim);
  }
  .chev {
    display: inline-flex;
    font-size: 30px;
    transition: transform 0.2s ease-out;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .learn-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
