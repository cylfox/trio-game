<script lang="ts">
  // The call banner over the player row: who called, the countdown digits and bar.
  import type { GameController } from '../game/controller.svelte.ts';
  import { fmtFixed, fmtSpot } from '../game/format.ts';
  import { locale, t } from '../lib/i18n/locale.svelte.ts';
  import type { CallLock } from '../lib/engine/engine.ts';
  import { enter, ref } from './attach.ts';
  import Units from './Units.svelte';

  interface Props {
    ctl: GameController;
    lock: CallLock;
    /** Host-clock now. */
    now: number;
    digitsEl?: HTMLElement | null;
    barEl?: HTMLElement | null;
  }

  let { ctl, lock, now, digitsEl = $bindable(null), barEl = $bindable(null) }: Props = $props();

  const mine = $derived(lock.playerId === ctl.me);
  const callMs = $derived(ctl.view?.config.callMs ?? null);
  const color = $derived(ctl.colorOf(lock.playerId).c);
  // Clamped to the countdown: a frame's clock can lag the call by a few ms.
  const left = $derived(lock.deadline === null ? null : Math.max(0, Math.min(callMs ?? Infinity, lock.deadline - now)));
  const frac = $derived(left === null || !callMs ? 1 : left / callMs);
  const urgent = $derived(left !== null && left <= 2000);
  const digits = $derived(left === null ? fmtFixed(locale.lang, Math.floor(Math.max(0, now - lock.calledAt) / 100) / 10, 1) : String(Math.ceil(left / 1000)));
  const kicker = $derived(
    mine && ctl.isTrain
      ? t(lock.deadline === null ? 'call.spotFree' : 'call.spot', { t: fmtSpot(locale.lang, ctl.clock.callSpot) })
      : mine
        ? t('call.yours')
        : t('call.boardLocked'),
  );
  const headline = $derived(mine ? t('call.pick') : t('game.theirCall', { name: ctl.nameOf(lock.playerId) }));
</script>

<div class="callbar" class:urgent class:nolimit={lock.deadline === null} style="--cc:{color}" role="status" {@attach enter('pop')} {@attach ref((el) => (barEl = el))}>
  <div class="cb-top">
    <span class="cb-label"><span><Units text={kicker} /></span><b>{headline}</b></span>
    <span class="cb-digits" {@attach ref((el) => (digitsEl = el))}>{digits}</span>
  </div>
  <div class="cb-track"><div class="cb-fill" style:transform="scaleX({frac.toFixed(4)})"></div></div>
</div>
