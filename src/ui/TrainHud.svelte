<script lang="ts">
  // Train HUD: the hero spot timer, the stat sheet and the pile.
  import type { GameController } from '../game/controller.svelte.ts';
  import { fmtClock, fmtSpot } from '../game/format.ts';
  import { locale, t } from '../lib/i18n/locale.svelte.ts';
  import { into, ref } from './attach.ts';
  import Pile from './Pile.svelte';

  let { ctl, frame }: { ctl: GameController; frame: number } = $props();

  const STATS = [
    ['last', 'hud.last'],
    ['best', 'hud.best'],
    ['avg', 'hud.avg'],
    ['total', 'hud.total'],
    ['sets', 'hud.sets'],
    ['wrong', 'hud.wrong'],
    ['to', 'hud.to'],
    ['hints', 'hud.hints'],
  ] as const;

  const color = { c: 'var(--you)', dim: 'var(--you-dim)', glow: 'var(--you-glow)' };
  const stats = $derived(ctl.trainStats);
  const spot = $derived.by(() => {
    void ctl.hero;
    return ctl.clock.display(frame);
  });
  const values = $derived.by((): Record<(typeof STATS)[number][0], string> => {
    const total = ctl.t0 === 0 ? 0 : (ctl.ended ? ctl.tEnd : frame) - ctl.t0;
    return {
      last: fmtSpot(locale.lang, ctl.attempts.at(-1)?.spot ?? null),
      best: fmtSpot(locale.lang, stats.best),
      avg: fmtSpot(locale.lang, stats.avg),
      total: fmtClock(total),
      sets: String(stats.sets),
      wrong: String(stats.wrong),
      to: String(stats.timeouts),
      hints: String(ctl.myStats?.hints ?? 0),
    };
  });
</script>

<div
  class="pp pp-train"
  style="--pc:{color.c};--pc-dim:{color.dim};--pc-glow:{color.glow}"
  {@attach ref((el) => (ctl.refs.hud = el))}
  {@attach into(ctl.refs.panels, ctl.me)}
>
  <div class="tr-hero" data-state={ctl.hero} {@attach ref((el) => (ctl.refs.hero = el))}>
    <span class="tr-k">{t('hud.spot')}</span>
    <span class="tr-spot"
      ><b class="tr-num" {@attach ref((el) => (ctl.refs.heroNum = el))}>{fmtSpot(locale.lang, spot)}</b><i>s</i></span
    >
  </div>
  <div class="tr-grid">
    {#each STATS as [key, label] (key)}
      <div class="tr-c"><span>{t(label)}</span><b {@attach into(ctl.refs.stats, key)}>{values[key]}</b></div>
    {/each}
  </div>
  <Pile {ctl} id={ctl.me} />
</div>
