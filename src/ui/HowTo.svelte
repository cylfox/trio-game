<script lang="ts">
  // "How to play": six short steps with small pixel illustrations.
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { BACK_HTML } from '../game/card-html.ts';
  import PixelIcon from './PixelIcon.svelte';
  import Units from './Units.svelte';

  const steps = [1, 2, 3, 4, 5, 6] as const;
</script>

<ol class="howto">
  {#each steps as n (n)}
    <li class="step">
      <span class="num" aria-hidden="true">{n}</span>
      <div class="txt">
        <h3 class="step-t">{t(`howto.s${n}t`)}</h3>
        <p class="step-b"><Units text={t(`howto.s${n}`)} /></p>
        {#if n === 1}
          <span class="art wifi"><PixelIcon name="wifi" size={0.9} /></span>
        {:else if n === 2}
          <span class="art"><span class="mini-set">{t('game.set')}</span></span>
        {:else if n === 3}
          <span class="art chips"><span class="pchip ok">+3</span><span class="pchip bad">−3</span><span class="pchip bad">−1</span></span>
        {:else if n === 4}
          <span class="art backs" aria-hidden="true">
            <!-- trusted markup: the card back -->
            {#each [0, 1, 2] as k (k)}<span class="cback mini-back" style="--k:{k}">{@html BACK_HTML}</span>{/each}
          </span>
        {:else if n === 5}
          <span class="art trophy"><PixelIcon name="trophy" size={0.9} /></span>
        {:else}
          <span class="art watch"><PixelIcon name="stopwatch" size={0.95} /></span>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .howto {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step {
    display: flex;
    gap: 10px;
    padding: 10px;
    border-radius: 12px;
    border: 3px solid var(--slab-edge);
    background: var(--well);
  }
  .num {
    flex: none;
    width: 30px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--cream);
    color: var(--ink-dark);
    font: 400 28px/1 var(--font-px);
    box-shadow:
      inset 0 -3px 0 var(--cream-shade),
      0 3px 0 var(--you-ledge);
  }
  .txt {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .step-t {
    font: 400 17px/1.1 var(--font-caps);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--you);
  }
  .step-b {
    font: 400 19px/1.2 var(--font-px);
    color: var(--ink-dim);
  }
  .art {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 26px;
    color: var(--ink);
  }
  .wifi {
    color: var(--ok);
  }
  .trophy {
    color: var(--you);
  }
  .watch {
    color: var(--partner);
  }
  .mini-set {
    padding: 2px 10px 1px;
    border: 2px solid var(--ink-dark);
    border-radius: 7px;
    background: linear-gradient(180deg, var(--you-hi), var(--you) 52%, var(--you-ledge) 160%);
    color: var(--ink-dark);
    font: 400 22px/1 var(--font-px);
    letter-spacing: 0.06em;
    box-shadow: 0 3px 0 var(--you-ledge);
  }
  .pchip {
    padding: 2px 7px 1px;
    border-radius: 7px;
    border: 2px solid currentColor;
    font: 400 20px/1 var(--font-px);
  }
  .pchip.ok {
    color: var(--ok);
  }
  .pchip.bad {
    color: var(--bad);
  }
  .backs {
    position: relative;
    height: 30px;
  }
  .mini-back {
    position: relative;
    font-size: 20px;
    margin-right: -10px;
    transform: rotate(calc((var(--k) - 1) * 8deg));
  }
</style>
