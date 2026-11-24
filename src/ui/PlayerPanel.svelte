<script lang="ts">
  // Versus: one player's panel (name, score, pile), coloured by seat.
  import type { GameController } from '../game/controller.svelte.ts';
  import { fmtScore } from '../game/format.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { into } from './attach.ts';
  import Pile from './Pile.svelte';

  let { ctl, id }: { ctl: GameController; id: string } = $props();

  const color = $derived(ctl.colorOf(id));
  const isMe = $derived(id === ctl.me);
  const calling = $derived(ctl.view?.lock?.playerId === id);
  const score = $derived(ctl.scores[id] ?? 0);
</script>

<div
  class="pp"
  class:calling
  class:away={ctl.away(id)}
  style="--pc:{color.c};--pc-dim:{color.dim};--pc-glow:{color.glow}"
  {@attach into(ctl.refs.panels, id)}
>
  <div class="pp-info">
    <div class="pp-name">
      <i class="pp-dot"></i><span class="pp-nm">{ctl.nameOf(id)}</span>
      {#if isMe && ctl.namedMe()}<em class="pp-tag">{t('seat.you')}</em>{/if}
    </div>
    <div class="pp-score">
      <span class="score" class:long={fmtScore(score).length > 2} {@attach into(ctl.refs.scores, id)}>{fmtScore(score)}</span><span class="pp-unit">{t('game.pts')}</span>
    </div>
  </div>
  <Pile {ctl} {id} />
</div>
