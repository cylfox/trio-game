<script lang="ts">
  // Per-call spot-time bars, drawn to scale from 0 to a rounded axis max. Tap a bar for details.
  import { onMount } from 'svelte';
  import { fmtSpotU } from '../game/format.ts';
  import { EASE, anim, reducedMotion } from '../game/motion.ts';
  import { chartModel } from '../game/train-stats.ts';
  import type { ChartBar, TrainAttempt } from '../game/train-stats.ts';
  import { play } from '../lib/audio/index.ts';
  import { locale, t } from '../lib/i18n/locale.svelte.ts';
  import Units from './Units.svelte';

  let { attempts }: { attempts: readonly TrainAttempt[] } = $props();

  const model = $derived(chartModel(attempts));
  let picked = $state<number | null>(null);
  let barsEl: HTMLElement | undefined = $state();

  function resText(a: TrainAttempt): string {
    return t(a.res === 'wrong' ? 'chart.wrong' : a.res === 'time' ? 'chart.time' : a.hinted ? 'chart.hint' : 'chart.set');
  }

  function read(bar: ChartBar): string {
    return t('chart.read', { i: bar.index + 1, spot: fmtSpotU(locale.lang, bar.attempt.spot), pick: fmtSpotU(locale.lang, bar.attempt.pick), res: resText(bar.attempt) });
  }

  function pick(i: number, sound: boolean): void {
    if (picked === i) return;
    picked = i;
    if (sound) play('count', { pitch: 1.2 });
  }

  onMount(() => {
    if (reducedMotion()) return;
    barsEl?.querySelectorAll('.cbar i').forEach((b, i) =>
      anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 420, delay: 300 + i * 25, easing: EASE.spring, fill: 'backwards' }),
    );
  });
</script>

{#if model === null}
  <div class="slab chart">
    <div class="chart-title">{t('chart.title')}</div>
    <p class="chart-read">{t('chart.noCalls')}</p>
  </div>
{:else}
  <div class="slab chart" role="group" aria-label={t('chart.aria', { n: model.bars.length, max: model.axis })}>
    <div class="chart-title">{t('chart.title')}</div>
    <div class="chart-plot">
      <span class="chart-max"><Units text={t('lobby.secs', { n: model.axis })} /></span>
      <div class="chart-bars" bind:this={barsEl}>
        {#each model.bars as bar (bar.index)}
          <button
            type="button"
            class="cbar {bar.kind}"
            class:on={picked === bar.index}
            style="--h:{bar.height.toFixed(2)}%"
            aria-label={read(bar)}
            onpointerenter={() => pick(bar.index, false)}
            onfocus={() => pick(bar.index, false)}
            onclick={() => pick(bar.index, true)}
          >
            <i></i>
            {#if bar.kind === 'best'}<em class="cbar-tag">{t('lg.best')}</em>{/if}
          </button>
        {/each}
      </div>
    </div>
    <div class="chart-axis"><span>{t('chart.first')}</span><span>{t('chart.last', { n: model.bars.length })}</span></div>
    <p class="chart-read" aria-live="polite">{picked === null ? t('chart.tap') : read(model.bars[picked])}</p>
    <div class="chart-legend">
      {#each model.legend as kind (kind)}<span><i class="lg-{kind}"></i>{t(`lg.${kind}`)}</span>{/each}
    </div>
  </div>
{/if}
