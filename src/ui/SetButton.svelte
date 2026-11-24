<script lang="ts">
  // The hero SET! button: idle, calling (my countdown fills it), locked (someone else's call).
  import type { GameController } from '../game/controller.svelte.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { ref } from './attach.ts';

  let { ctl, now }: { ctl: GameController; now: number } = $props();

  const lock = $derived(ctl.view?.lock ?? null);
  const mine = $derived(lock !== null && lock.playerId === ctl.me);
  const theirs = $derived(lock !== null && lock.playerId !== ctl.me);
  const callMs = $derived(ctl.view?.config.callMs ?? null);
  const left = $derived(lock?.deadline == null ? null : Math.max(0, Math.min(callMs ?? Infinity, lock.deadline - now)));
  const frac = $derived(mine && left !== null && callMs ? left / callMs : 0);
  const urgent = $derived(mine && left !== null && left <= 2000);
  const secs = $derived(left === null ? null : Math.ceil(left / 1000));

  function down(e: PointerEvent): void {
    if (e.button > 0) return;
    e.preventDefault();
    ctl.pressSet();
  }

  function click(e: MouseEvent): void {
    if (e.detail === 0) ctl.pressSet(); // keyboard activation
  }
</script>

<button
  class="setbtn"
  class:calling={mine}
  class:locked={theirs}
  class:urgent
  class:down={ctl.callPending && !lock}
  type="button"
  disabled={ctl.ended}
  aria-label={mine ? t('game.pick3Aria') : theirs ? t('game.lockedAria') : t('game.callSet')}
  onpointerdown={down}
  onclick={click}
  {@attach ref((el) => (ctl.refs.setBtn = el))}
>
  <span class="set-fill" style:transform="scaleX({frac.toFixed(4)})"></span>
  <span class="set-label"
    >{#if mine}{t('game.pick3')}{#if !ctl.isTrain && secs !== null}<small>{t('game.secShort', { n: secs })}</small>{/if}{:else if theirs}{t(
        'game.locked',
      )}{:else}{t('game.set')}{/if}</span
  >
</button>
