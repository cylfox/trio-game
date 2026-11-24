<script lang="ts">
  import { COLORS, SHADINGS, SHAPES, decodeCard } from '../lib/engine/engine.ts';
  import type { CardId } from '../lib/engine/engine.ts';
  import { cardName } from '../lib/i18n/locale.svelte.ts';
  import { snapSymbolWidth, symbolHeightFor, symbolImage } from '../lib/symbols.ts';

  interface Props {
    card: CardId;
    selected?: boolean;
    hinted?: boolean;
    disabled?: boolean;
    onpick?: (card: CardId) => void;
  }

  let { card, selected = false, hinted = false, disabled = false, onpick }: Props = $props();

  let tileWidth = $state(0);
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const features = $derived(decodeCard(card));
  const image = $derived(symbolImage(SHAPES[features.shape], SHADINGS[features.shading], COLORS[features.color]));
  // Whole device pixels per grid pixel, so the pixel art stays even.
  const symbolWidth = $derived(tileWidth > 0 ? snapSymbolWidth(tileWidth * 0.78, dpr) : 0);
</script>

<button
  type="button"
  bind:clientWidth={tileWidth}
  class="flex aspect-[4/5] w-full flex-col items-center justify-center gap-[6%] rounded-lg border-4 bg-cream p-[8%] transition-transform
    {selected ? 'border-you -translate-y-1' : hinted ? 'border-ok' : 'border-cream-edge'}
    {disabled ? 'opacity-80' : 'active:scale-95'}"
  aria-label={cardName(card)}
  aria-pressed={selected}
  {disabled}
  onclick={() => onpick?.(card)}
>
  {#each { length: features.number + 1 } as _, i (i)}
    <svg
      viewBox={image.viewBox}
      shape-rendering="crispEdges"
      width={symbolWidth || undefined}
      height={symbolWidth ? symbolHeightFor(symbolWidth) : undefined}
      class={symbolWidth ? 'shrink-0' : 'w-[78%]'}
      aria-hidden="true"
    >
      {#each image.paths as path (path.fill)}
        <path fill={path.fill} d={path.d} />
      {/each}
    </svg>
  {/each}
</button>
