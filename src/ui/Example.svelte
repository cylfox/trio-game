<script lang="ts">
  // One "What's a trio?" example: three cards, the verdict and a chip per feature.
  import { judge } from '../game/examples.ts';
  import type { Trio } from '../game/examples.ts';
  import { cardName, t } from '../lib/i18n/locale.svelte.ts';
  import CardFace from './CardFace.svelte';
  import PixelIcon from './PixelIcon.svelte';

  interface Props {
    ids: Trio;
    title: string;
    live?: boolean;
  }

  let { ids, title, live = false }: Props = $props();

  const EX_CARD_W = 54;
  const verdicts = $derived(judge(ids));
  const valid = $derived(verdicts.every((v) => v.ok));
  const odd = $derived(new Set(verdicts.filter((v) => !v.ok).map((v) => v.odd)));
</script>

<div class="ex" aria-live={live ? 'polite' : undefined}>
  <div class="ex-head">
    <span class="ex-title">{title}</span>
    <span class="ex-verdict {valid ? 'ok' : 'bad'}" data-verdict
      >{valid ? t('learn.isSet') : t('learn.notSet')}<PixelIcon name={valid ? 'check' : 'cross'} size={0.75} /></span
    >
  </div>
  <div class="ex-cards">
    {#each ids as card, i (`${card}-${i}`)}
      <CardFace
        {card}
        width={EX_CARD_W}
        class="ex-card{odd.has(i) ? ' odd' : ''}"
        label={odd.has(i) ? t('learn.oddOne', { card: cardName(card) }) : cardName(card)}
      />
    {/each}
  </div>
  <div class="ex-chips">
    {#each verdicts as v (v.feature)}
      <span class="ex-chip {v.ok ? 'ok' : 'bad'}">
        <b>{t(`learn.f.${v.feature}`)}</b>
        <span
          >{#if v.ok}{v.same ? t('learn.allSame') : t('learn.allDiff')}{:else}{t('learn.twoOne')}<PixelIcon name="cross" size={0.62} label={t('learn.notSet')} />{/if}</span
        >
      </span>
    {/each}
  </div>
</div>
