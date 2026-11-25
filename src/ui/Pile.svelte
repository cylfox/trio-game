<script lang="ts">
  // A player's pile: the last trio found, fanned, and the trio count.
  import type { GameController } from '../game/controller.svelte.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { into } from './attach.ts';
  import CardFace from './CardFace.svelte';

  let { ctl, id }: { ctl: GameController; id: string } = $props();

  const FAN = [
    { dx: -11, dy: 2, r: -14 },
    { dx: 0, dy: -2, r: 0 },
    { dx: 11, dy: 2, r: 14 },
  ];
  const pile = $derived(ctl.piles[id] ?? { last: [], sets: 0 });
</script>

<div class="pile" class:has={pile.last.length > 0} role="img" aria-label={t('game.setsWon', { count: pile.sets })} {@attach into(ctl.refs.piles, id)}>
  <div class="pile-fan">
    {#each pile.last as card, k (card)}
      <CardFace {card} width={26} fit={false} class="mini" style="--dx:{FAN[k].dx}px;--dy:{FAN[k].dy}px;--r:{FAN[k].r}deg" />
    {/each}
  </div>
  <span class="pile-count" aria-hidden="true">{pile.sets}</span>
</div>
