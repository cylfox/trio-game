<script lang="ts">
  // The game screen: player panels (or the Train HUD) with the call banner, the table with its
  // card layer, and the bottom bar (deck, TRIO!, hint, status chip, menu).
  import { onMount } from 'svelte';
  import type { GameController } from '../game/controller.svelte.ts';
  import { BACK_HTML } from '../game/card-html.ts';
  import { EASE, T, anim, reducedMotion } from '../game/motion.ts';
  import { Table } from '../game/table.ts';
  import { play, tickFor } from '../lib/audio/index.ts';
  import { cardName, locale, t } from '../lib/i18n/locale.svelte.ts';
  import CallBar from './CallBar.svelte';
  import Menu from './Menu.svelte';
  import PlayerPanel from './PlayerPanel.svelte';
  import RulesSheet from './RulesSheet.svelte';
  import SetButton from './SetButton.svelte';
  import TrainHud from './TrainHud.svelte';
  import Units from './Units.svelte';
  import { enter, leave } from './attach.ts';
  import type { CallLock } from '../lib/engine/engine.ts';
  import { ui } from './toasts.svelte.ts';
  import { ROOM_SERVER } from '../lib/net/config.ts';

  let { ctl, onleave }: { ctl: GameController; onleave: () => void } = $props();

  /** Keys that press TRIO!: T, and S as an alias. */
  const CALL_KEYS: ReadonlySet<string> = new Set(['t', 'T', 's', 'S']);

  let gameEl: HTMLElement;
  let boardEl: HTMLElement;
  let layerEl: HTMLElement;
  let deckStack: HTMLElement;
  let menuBtn: HTMLButtonElement;
  let rulesOpen = $state(false);
  let digitsEl: HTMLElement | null = $state(null);
  let barEl: HTMLElement | null = $state(null);
  /** The lock the banner shows: it outlives the call by its fade-out. */
  let barLock = $state.raw<CallLock | null>(null);
  let barLeaving = false;

  /** Host-clock now and performance.now, refreshed every frame. */
  let now = $state(0);
  let frame = $state(performance.now());

  const view = $derived(ctl.view);
  const lock = $derived(view?.lock ?? null);
  const callingMe = $derived(lock !== null && lock.playerId === ctl.me);
  const frozen = $derived(lock !== null && lock.playerId !== ctl.me);
  const deckLayers = $derived(ctl.deckCount <= 0 ? 0 : Math.min(5, Math.ceil(ctl.deckCount / 12)));
  const callMs = $derived(view?.config.callMs ?? null);

  const chip = $derived.by((): { text: string; tone: 'online' | 'offline' | 'away' } => {
    const snap = ctl.snap;
    if (ctl.isTrain) return { text: callMs ? t('chip.train', { n: Math.round(callMs / 1000) }) : t('chip.trainOff'), tone: 'offline' };
    if (snap.status === 'hostAway') return { text: ctl.net === 'server' ? t('chip.reconnectingServer') : t('chip.reconnecting'), tone: 'away' };
    const away = snap.room?.seats.find((s) => s.id !== ctl.me && !s.connected);
    if (away) return { text: t('chip.peerAway', { name: ctl.nameOf(away.id) }), tone: 'away' };
    const direct = ctl.net === 'p2p' && ROOM_SERVER !== null;
    return { text: t(direct ? 'chip.onlineDirect' : 'chip.online', { code: snap.code ?? '' }), tone: 'online' };
  });

  function openMenu(): void {
    play('ui');
    ctl.setMenu(true);
  }

  function closeMenu(): void {
    ctl.setMenu(false);
    menuBtn?.focus({ preventScroll: true });
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (rulesOpen) rulesOpen = false;
      else if (ctl.menuOpen) closeMenu();
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    // T calls TRIO!; S still works (the old SET! shortcut).
    if (CALL_KEYS.has(e.key) && tag !== 'INPUT' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      if (!ctl.menuOpen && !rulesOpen) ctl.pressSet();
    }
  }

  // Countdown digits: a pop and a tick per second, tenser in the last 2 s. Train: the hero bumps.
  let lastSecs = -1;
  let lastHeroSec = 0;
  function perSecond(): void {
    if (lock !== null) {
      const secs = lock.deadline === null ? Math.floor(Math.max(0, now - lock.calledAt) / 1000) : Math.ceil(Math.max(0, Math.min(callMs ?? Infinity, lock.deadline - now)) / 1000);
      if (secs !== lastSecs) {
        const first = lastSecs === -1;
        lastSecs = secs;
        if (!first) {
          void anim(digitsEl, [{ transform: lock.deadline === null ? 'scale(1.3)' : 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: T(240), easing: EASE.spring });
          if (lock.deadline !== null && secs > 0) play(tickFor(secs));
        }
      }
    } else lastSecs = -1;
    if (ctl.isTrain && ctl.clock.state === 'run') {
      const sec = Math.floor(ctl.clock.value(frame) / 1000);
      if (sec !== lastHeroSec) {
        lastHeroSec = sec;
        if (sec > 0 && !reducedMotion()) void anim(ctl.refs.heroNum, [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      }
    } else lastHeroSec = 0;
  }

  onMount(() => {
    const table = new Table(
      {
        game: gameEl,
        board: boardEl,
        layer: layerEl,
        deckTop: () => (deckStack?.lastElementChild as HTMLElement | null) ?? deckStack ?? null,
        pile: (id) => ctl.refs.piles.get(id) ?? null,
      },
      {
        tap: (v) => ctl.tap(v),
        label: (id) => cardName(id),
        layout: (L) => (ui.toastTop = L.top + 10),
      },
    );
    ctl.attach(table);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => table.onResize()) : null;
    ro?.observe(boardEl);
    const onResize = () => table.onResize();
    window.addEventListener('resize', onResize);
    let raf = 0;
    const loop = () => {
      now = ctl.session.hostNow();
      frame = performance.now();
      perSecond();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      ctl.detach();
      ui.toastTop = 14;
    };
  });

  // The call banner: in with the call, out with a short fade once the call resolves.
  $effect(() => {
    const current = lock;
    if (current !== null) {
      barLeaving = false;
      barLock = current;
    } else if (barLock !== null && !barLeaving) {
      barLeaving = true;
      void leave(barEl).then(() => {
        if (barLeaving) {
          barLeaving = false;
          barLock = null;
        }
      });
    }
  });

  // Card names follow the language.
  $effect(() => {
    void locale.lang;
    ctl.relabel();
  });
</script>

<svelte:window onkeydown={onKey} />

<section class="screen" aria-label={t('aria.game')} {@attach enter('screen')}>
  <div class="game" class:mode-train={ctl.isTrain} class:calling-me={callingMe} bind:this={gameEl}>
    <header class="players" style="--n:{ctl.isTrain ? 1 : Math.max(1, ctl.order.length)}">
      {#if ctl.isTrain}
        <TrainHud {ctl} {frame} />
      {:else}
        {#each ctl.order as id (id)}<PlayerPanel {ctl} {id} />{/each}
      {/if}
      {#if barLock !== null}
        {#key `${barLock.playerId}:${barLock.calledAt}`}
          <CallBar {ctl} lock={barLock} {now} bind:digitsEl bind:barEl />
        {/key}
      {/if}
    </header>

    <main class="board" class:frozen bind:this={boardEl} aria-label={t('aria.table')}></main>

    <footer class="bar slab">
      <div class="deck" class:empty={ctl.deckCount <= 0} role="img" aria-label={t('game.deckAria', { count: ctl.deckCount })}>
        <div class="deck-stack" bind:this={deckStack}>
          {#each { length: deckLayers } as _, i (i)}
            <!-- trusted markup: the card back -->
            <div class="deck-card cback" style="--i:{i}">{@html BACK_HTML}</div>
          {/each}
        </div>
        <span class="deck-count">{ctl.deckCount}</span>
      </div>
      <div class="bar-mid">
        <div class="bar-row">
          <SetButton {ctl} {now} />
          {#if ctl.isTrain}
            <button class="btn btn-slate btn-hint" type="button" disabled={ctl.ended} onclick={() => ctl.hint()}>{t('game.hint')}</button>
          {/if}
        </div>
        <div class="chip" class:offline={chip.tone === 'offline'} class:away={chip.tone === 'away'}><i></i><span><Units text={chip.text} /></span></div>
        {#if ctl.tip}
          {#key ctl.tip.id}
            <div class="set-tip" role="status" {@attach enter('tip')}>{ctl.tip.text}</div>
          {/key}
        {/if}
      </div>
      <button class="btn btn-slate btn-icon" type="button" aria-label={t('aria.menu')} aria-haspopup="dialog" bind:this={menuBtn} onclick={openMenu}>
        <span class="menu-bars"><i></i><i></i><i></i></span>
      </button>
    </footer>

    <div class="layer" class:frozen bind:this={layerEl}></div>
  </div>

  {#if ctl.menuOpen}
    <Menu {ctl} onclose={closeMenu} onrules={() => (rulesOpen = true)} onleave={() => (closeMenu(), onleave())} />
  {/if}
  {#if rulesOpen}
    <RulesSheet onclose={() => (rulesOpen = false)} />
  {/if}
</section>
