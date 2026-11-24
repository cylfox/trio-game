<script lang="ts">
  // TEMPORARY debug screen: just enough UI to prove two browsers can play. Replace with the real UI.
  import { onMount } from 'svelte';
  import { playerStats } from '../lib/engine/engine.ts';
  import type { CardId, GameEvent } from '../lib/engine/engine.ts';
  import { LANGS, isMessageKey } from '../lib/i18n/index.ts';
  import { cardName, locale, seconds, setLang, t } from '../lib/i18n/locale.svelte.ts';
  import { openRoom, openTrain } from '../lib/net/connect.ts';
  import { createWakeLock, onVisible } from '../lib/net/lifecycle.ts';
  import { MIN_PLAYERS } from '../lib/net/protocol.ts';
  import type { DenyReason, Seat } from '../lib/net/protocol.ts';
  import { codeFromHash, inviteLink, normalizeCode } from '../lib/net/room-code.ts';
  import type { Change, RoomSession, SessionState } from '../lib/net/session.ts';
  import { browserStore, forgetRoom, loadIdentity, saveName } from '../lib/net/storage.ts';
  import CardTile from './CardTile.svelte';

  type Tone = 'info' | 'good' | 'bad';
  interface LogLine {
    readonly id: number;
    readonly tone: Tone;
    /** Rendered on display, so the log follows a language switch. */
    readonly text: () => string;
  }

  const store = browserStore();
  const wake = createWakeLock();
  const appUrl = new URL(import.meta.env.BASE_URL, location.origin).href;

  const initialIdentity = loadIdentity(store);
  let identity = $state(initialIdentity);
  let nameInput = $state(initialIdentity.name);
  let codeInput = $state('');
  let codeError = $state(false);
  let noLimit = $state(false);
  let copied = $state(false);
  let session = $state.raw<RoomSession | null>(null);
  let snap = $state.raw<SessionState | null>(null);
  let selected = $state<CardId[]>([]);
  let hintCard = $state<CardId | null>(null);
  let now = $state(Date.now());
  let log = $state.raw<LogLine[]>([]);
  let logId = 0;
  let unsubscribe: (() => void) | null = null;

  const me = $derived(identity.id);
  const view = $derived(snap?.view ?? null);
  const room = $derived(snap?.room ?? null);
  const isTrain = $derived(snap?.role === 'train');
  const lock = $derived(view?.lock ?? null);
  const myCall = $derived(lock !== null && lock.playerId === me);
  const inGame = $derived(view !== null && view.players.some((p) => p.id === me));
  const remaining = $derived(lock === null || lock.deadline === null ? null : Math.max(0, lock.deadline - now));
  const invite = $derived(snap?.code ? inviteLink(appUrl, snap.code) : '');
  const mySeat = $derived(room?.seats.find((s) => s.id === me));
  const stats = $derived(view === null ? undefined : playerStats(view, me));
  const lastAttempt = $derived(stats?.attempts.at(-1));
  const canStart = $derived(room !== null && room.seats.length >= MIN_PLAYERS && room.seats.every((s) => s.connected));
  const result = $derived.by(() => {
    if (view === null || !view.over || isTrain) return null;
    const top = Math.max(...view.players.map((p) => p.score));
    const winners = view.players.filter((p) => p.score === top);
    return winners.length === 1 ? t('game.winner', { name: nameOf(winners[0].id) }) : t('game.tie');
  });

  function nameOf(id: string): string {
    const seat = room?.seats.find((s) => s.id === id);
    const name = seat?.name || (id === me ? identity.name : '');
    return name || t('player.unnamed', { tag: id.slice(0, 4).toUpperCase() });
  }

  function scoreOf(id: string): number | undefined {
    return view?.players.find((p) => p.id === id)?.score;
  }

  function add(text: () => string, tone: Tone = 'info'): void {
    log = [{ id: ++logId, text, tone }, ...log].slice(0, 80);
  }

  function why(reason: string): string {
    const key = `why.${reason}`;
    return isMessageKey(key) ? t(key) : reason;
  }

  function denyText(reason: DenyReason): string {
    return reason === 'full' ? t('deny.full') : reason === 'version' ? t('deny.version') : t('deny.duplicate');
  }

  function points(score: number): string {
    return t('score.points', { count: score });
  }

  function logEvent(e: GameEvent): void {
    switch (e.type) {
      case 'newGame':
        return add(() => t('ev.newGame'));
      case 'call':
        return add(() => t('ev.call', { name: nameOf(e.playerId) }));
      case 'locked':
        return add(() => t('ev.locked', { name: nameOf(e.playerId), holder: nameOf(e.holder) }), 'bad');
      case 'cooldown':
        return add(() => t('ev.cooldown', { name: nameOf(e.playerId) }), 'bad');
      case 'retire':
        return isTrain
          ? add(() => t('ev.foundTrain', { time: seconds(e.at - e.calledAt) }), 'good')
          : add(() => t('ev.found', { name: nameOf(e.playerId), points: points(e.score) }), 'good');
      case 'wrong':
        return isTrain
          ? add(() => t('ev.wrongTrain'), 'bad')
          : add(() => t('ev.wrong', { name: nameOf(e.playerId), penalty: e.penalty, points: points(e.score) }), 'bad');
      case 'timeout':
        return isTrain
          ? add(() => t('ev.timeoutTrain'), 'bad')
          : add(() => t('ev.timeout', { name: nameOf(e.playerId), penalty: e.penalty, points: points(e.score) }), 'bad');
      case 'stale':
        return add(() => t('ev.stale', { name: nameOf(e.playerId) }), 'bad');
      case 'hint':
        return add(() => t('ev.hint', { card: cardName(e.card) }));
      case 'autoDeal':
        return add(() => t('ev.autoDeal'));
      case 'manualDeal':
        return add(() => t('ev.manualDeal'));
      case 'gameOver':
        return add(() => t('game.over'), 'good');
      default:
        return; // deal, move: animation only
    }
  }

  function onChange(state: SessionState, change: Change): void {
    snap = state;
    now = session?.hostNow() ?? Date.now();
    switch (change.type) {
      case 'state': {
        if (change.kind === 'snapshot') add(() => t('log.snapshot'));
        for (const e of change.events) {
          if (e.type === 'hint' && e.playerId === me) hintCard = e.card;
          logEvent(e);
        }
        const board = state.view?.board ?? [];
        if (state.view?.lock?.playerId !== me) selected = [];
        selected = selected.filter((c) => board.includes(c));
        if (hintCard !== null && !board.includes(hintCard)) hintCard = null;
        return;
      }
      case 'join':
        return add(() => t('log.join', { name: change.name || nameOf(change.playerId) }), 'good');
      case 'rejoin':
        return add(() => t('log.rejoin', { name: change.name || nameOf(change.playerId) }), 'good');
      case 'leave':
        return add(() => t('log.leave', { name: change.name || nameOf(change.playerId) }), 'bad');
      case 'denied':
        if (change.playerId === me) return add(() => denyText(change.reason), 'bad');
        return add(() => t('log.denied', { name: change.name || nameOf(change.playerId), reason: t(`reason.${change.reason}`) }), 'bad');
      case 'rejected':
        return add(() => t('log.rejected', { reason: why(change.reason) }), 'bad');
      case 'hostAway':
        return add(() => t('log.hostAway'), 'bad');
      case 'hostBack':
        return add(() => t('log.hostBack'), 'good');
      case 'closed':
        return add(() => t('log.closed'), 'bad');
      case 'error':
        return add(() => t('log.error', { code: change.code }), 'bad');
    }
  }

  function attach(next: RoomSession): void {
    unsubscribe?.();
    session = next;
    snap = next.getState();
    selected = [];
    hintCard = null;
    log = [];
    unsubscribe = next.subscribe(onChange);
    if (next.role === 'train') add(() => t('ev.newGame'));
  }

  function saveMyName(): void {
    identity = saveName(store, nameInput);
    nameInput = identity.name;
  }

  function startOnline(code: string | null): void {
    saveMyName();
    const opened = openRoom(code, identity, store);
    attach(opened.session);
    history.replaceState(null, '', `#${opened.code}`);
  }

  function startTrain(): void {
    saveMyName();
    attach(openTrain(identity, noLimit ? { callMs: null } : undefined));
  }

  function joinTyped(event: SubmitEvent): void {
    event.preventDefault();
    const code = normalizeCode(codeInput);
    codeError = code === null;
    if (code !== null) startOnline(code);
  }

  async function leave(): Promise<void> {
    const current = session;
    const state = snap;
    unsubscribe?.();
    unsubscribe = null;
    session = null;
    snap = null;
    selected = [];
    hintCard = null;
    if (current !== null) await current.leave();
    if (state?.role === 'host' && state.code !== null) forgetRoom(store, state.code);
    history.replaceState(null, '', location.pathname + location.search);
  }

  function pick(card: CardId): void {
    if (session === null || !myCall) return;
    selected = selected.includes(card) ? selected.filter((c) => c !== card) : [...selected, card];
    if (selected.length === 3) {
      const cards = selected;
      selected = [];
      session.act({ type: 'claim', cards, hinted: hintCard !== null && cards.includes(hintCard) });
    }
  }

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(invite);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function seatTags(seat: Seat): string {
    const tags = [];
    if (seat.id === me) tags.push(t('seat.you'));
    if (seat.id === room?.hostId) tags.push(t('seat.host'));
    if (!seat.connected) tags.push(t('seat.away'));
    if (seat.rematch && room?.phase === 'over') tags.push(t('seat.rematch'));
    return tags.join(' · ');
  }

  // Countdown: follow the host's clock while a timed call is held.
  $effect(() => {
    const current = session;
    if (current === null || lock === null || lock.deadline === null) return;
    now = current.hostNow();
    const timer = setInterval(() => (now = current.hostNow()), 100);
    return () => clearInterval(timer);
  });

  // Keep the screen on while a game is running.
  $effect(() => {
    wake.set(view !== null && !view.over);
  });

  onMount(() => {
    const code = codeFromHash(location.hash);
    if (code !== null) startOnline(code);
    const onHash = () => {
      const next = codeFromHash(location.hash);
      if (next !== null && next !== snap?.code) void leave().then(() => startOnline(next));
    };
    window.addEventListener('hashchange', onHash);
    const offVisible = onVisible(() => session?.resync());
    return () => {
      window.removeEventListener('hashchange', onHash);
      offVisible();
      wake.destroy();
      void session?.leave();
    };
  });
</script>

<main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
  <header class="flex items-center justify-between gap-2">
    <h1 class="font-display text-4xl text-you">{t('app.name')}</h1>
    <div class="flex gap-1" role="group" aria-label={t('lang.label')}>
      {#each LANGS as lang (lang)}
        <button
          type="button"
          class="rounded border-2 px-2 text-sm uppercase {locale.lang === lang ? 'border-you text-you' : 'border-slab-edge text-ink-dim'}"
          aria-pressed={locale.lang === lang}
          onclick={() => setLang(lang)}>{lang}</button
        >
      {/each}
    </div>
  </header>
  <p class="text-xs text-ink-faint">{t('app.debug')}</p>

  {#if session === null || snap === null}
    <!-- ── Menu ─────────────────────────────────────────────────────────────── -->
    <label class="flex flex-col gap-1">
      <span class="text-sm text-ink-dim">{t('name.label')}</span>
      <input
        class="rounded border-2 border-slab-edge bg-well px-3 py-2 text-lg"
        maxlength="24"
        placeholder={t('name.placeholder')}
        bind:value={nameInput}
        onchange={saveMyName}
      />
    </label>

    <section class="flex flex-col gap-2 rounded-lg border-2 border-slab-edge bg-slab p-3">
      <button type="button" class="rounded bg-you px-4 py-2 font-display text-3xl text-ink-dark" onclick={startTrain}>{t('menu.train')}</button>
      <label class="flex items-center gap-2 text-sm text-ink-dim">
        <input type="checkbox" bind:checked={noLimit} />
        {t('menu.trainNoLimit')}
      </label>
    </section>

    <section class="flex flex-col gap-2 rounded-lg border-2 border-slab-edge bg-slab p-3">
      <h2 class="font-display text-2xl">{t('menu.online')}</h2>
      <button type="button" class="rounded bg-partner px-4 py-2 font-display text-2xl text-ink-dark" onclick={() => startOnline(null)}
        >{t('menu.create')}</button
      >
      <form class="flex gap-2" onsubmit={joinTyped}>
        <input
          class="w-28 rounded border-2 border-slab-edge bg-well px-3 py-2 text-center text-2xl uppercase tracking-widest"
          maxlength="9"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          aria-label={t('menu.code')}
          placeholder="K7QX"
          bind:value={codeInput}
        />
        <button type="submit" class="flex-1 rounded border-2 border-partner px-3 py-2 text-lg text-partner">{t('menu.join')}</button>
      </form>
      {#if codeError}<p class="text-sm text-bad">{t('menu.badCode')}</p>{/if}
    </section>
  {:else}
    <!-- ── Room / train header ──────────────────────────────────────────────── -->
    <section class="flex flex-col gap-2 rounded-lg border-2 border-slab-edge bg-slab p-3">
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="font-display text-2xl">
          {snap.code === null ? t('role.train') : t('room.title', { code: snap.code })}
        </h2>
        <button type="button" class="rounded border-2 border-bad px-3 text-sm text-bad" onclick={leave}>{t('game.leave')}</button>
      </div>
      {#if snap.role !== 'train' && snap.status !== 'denied'}
        <p class="text-sm text-ink-dim">
          {snap.role === 'host' ? t('role.host') : t('role.guest')} ·
          <span data-testid="status">{t(`status.${snap.status}`)}</span>
        </p>
        {#if snap.role === 'host'}
          <div class="flex items-center gap-2">
            <input class="min-w-0 flex-1 rounded bg-well px-2 py-1 text-xs text-ink-dim" readonly value={invite} aria-label={t('room.invite')} />
            <button type="button" class="rounded border-2 border-slab-edge px-2 text-sm" onclick={copyInvite}>
              {copied ? t('room.copied') : t('room.copy')}
            </button>
          </div>
        {/if}
      {/if}

      {#if snap.status === 'denied'}
        <p class="font-display text-3xl text-bad" data-testid="denied">{denyText(snap.denied ?? 'full')}</p>
        {#if snap.denied === 'full'}<p class="text-sm">{t('deny.fullDetail', { count: room?.maxPlayers ?? 2 })}</p>{/if}
      {:else if snap.status === 'closed'}
        <p class="text-bad">{t('status.closed')}</p>
      {:else if snap.status === 'hostAway'}
        <p class="text-bad">{t('status.hostAway')}</p>
      {/if}

      {#if room !== null}
        <h3 class="text-sm text-ink-dim">{t('seats.title')}</h3>
        <ul class="flex flex-col gap-1" data-testid="seats">
          {#each room.seats as seat (seat.id)}
            <li class="flex items-baseline justify-between gap-2 rounded bg-well px-2 py-1 {seat.connected ? '' : 'opacity-60'}">
              <span class={seat.id === me ? 'text-you' : 'text-partner'}>
                {nameOf(seat.id)} <span class="text-xs text-ink-faint">{seatTags(seat)}</span>
              </span>
              {#if scoreOf(seat.id) !== undefined}
                <span class="font-display text-2xl">{scoreOf(seat.id)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- ── Lobby ────────────────────────────────────────────────────────────── -->
    {#if room?.phase === 'lobby' && snap.status === 'online'}
      {#if snap.role === 'host'}
        {#if room.seats.length < MIN_PLAYERS}<p class="text-ink-dim">{t('lobby.waiting')}</p>{/if}
        <button
          type="button"
          class="rounded bg-you px-4 py-2 font-display text-3xl text-ink-dark disabled:opacity-40"
          disabled={!canStart}
          onclick={() => session?.act({ type: 'start' })}>{t('lobby.start')}</button
        >
      {:else}
        <p class="text-ink-dim">{t('lobby.waitHost')}</p>
      {/if}
    {/if}

    <!-- ── Game ─────────────────────────────────────────────────────────────── -->
    {#if view !== null && snap.status !== 'denied'}
      {#if !inGame}<p class="text-ink-dim">{t('game.watching')}</p>{/if}

      <div class="flex items-center justify-between gap-2 text-sm text-ink-dim">
        <span>{t('game.deck', { count: view.deckCount })}</span>
        {#if lock !== null}
          <span class={myCall ? 'text-you' : 'text-partner'} data-testid="call">
            {myCall ? t('game.yourCall') : t('game.theirCall', { name: nameOf(lock.playerId) })}
          </span>
        {/if}
      </div>

      <div class="grid grid-cols-3 gap-2" data-testid="board">
        {#each view.board as card, slot (card ?? `empty-${slot}`)}
          {#if card !== null}
            <CardTile
              {card}
              selected={selected.includes(card)}
              hinted={hintCard === card}
              disabled={!inGame || view.over || (lock !== null && !myCall)}
              onpick={pick}
            />
          {/if}
        {/each}
      </div>

      {#if !view.over}
        <div class="flex items-stretch gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg bg-you py-3 font-display text-5xl text-ink-dark shadow-[0_6px_0_#b67a12] active:translate-y-1 active:shadow-none disabled:bg-slab-edge disabled:text-ink-faint disabled:shadow-none"
            data-testid="set"
            disabled={!inGame || lock !== null}
            onclick={() => session?.act({ type: 'call' })}>{t('game.set')}</button
          >
          <div class="flex w-28 flex-col items-center justify-center rounded-lg bg-well" data-testid="countdown">
            {#if lock !== null}
              <span class="font-display text-3xl {myCall ? 'text-you' : 'text-partner'}">
                {remaining === null ? '∞' : seconds(remaining, 1)}
              </span>
              <span class="text-xs text-ink-faint">{remaining === null ? t('game.noLimit') : ''}</span>
            {/if}
          </div>
        </div>
      {/if}

      {#if isTrain}
        <div class="flex gap-2">
          <button type="button" class="flex-1 rounded border-2 border-ok px-3 py-1 text-ok disabled:opacity-40" disabled={view.over} onclick={() => session?.act({ type: 'hint' })}
            >{t('game.hint')}</button
          >
          <button
            type="button"
            class="flex-1 rounded border-2 border-slab-edge px-3 py-1 disabled:opacity-40"
            disabled={view.over || lock !== null}
            onclick={() => session?.act({ type: 'dealMore' })}>{t('game.dealMore')}</button
          >
        </div>
        {#if stats !== undefined}
          <p class="text-sm text-ink-dim" data-testid="stats">
            {t('stats.sets', { count: stats.setsFound })} · {t('stats.mistakes', { count: stats.mistakes })} ·
            {t('stats.timeouts', { count: stats.timeouts })} · {t('stats.hints', { count: stats.hints })}
          </p>
          {#if lastAttempt !== undefined}
            <p class="text-sm text-ink-dim">
              {t('stats.last', {
                spotLabel: t('stats.spot'),
                spot: lastAttempt.gapMs === null ? '—' : seconds(lastAttempt.gapMs),
                pickLabel: t('stats.pick'),
                pick: seconds(lastAttempt.pickMs),
              })}
            </p>
          {/if}
        {/if}
      {/if}

      {#if view.over}
        <p class="font-display text-4xl text-you" data-testid="result">{result ?? t('game.over')}</p>
        {#if isTrain}
          <button type="button" class="rounded bg-you px-4 py-2 font-display text-3xl text-ink-dark" onclick={() => session?.act({ type: 'rematch' })}
            >{t('game.newGame')}</button
          >
        {:else if mySeat?.rematch}
          <p class="text-ink-dim">{t('game.waitRematch')}</p>
        {:else}
          <button type="button" class="rounded bg-you px-4 py-2 font-display text-3xl text-ink-dark" onclick={() => session?.act({ type: 'rematch' })}
            >{t('game.rematch')}</button
          >
        {/if}
      {/if}

      <p class="text-xs text-ink-faint">
        {t('feature.shape')}: {t('shape.diamond')}, {t('shape.squiggle')}, {t('shape.oval')} ·
        {t('feature.color')}: {t('color.red')}, {t('color.green')}, {t('color.purple')} ·
        {t('feature.number')}: 1, 2, 3 ·
        {t('feature.shading')}: {t('shading.solid')}, {t('shading.striped')}, {t('shading.open')}
      </p>
    {/if}

    <!-- ── Event log ────────────────────────────────────────────────────────── -->
    <section class="flex flex-col gap-1">
      <h3 class="text-sm text-ink-dim">{t('log.title')}</h3>
      <ol class="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded bg-well p-2 text-sm" data-testid="log">
        {#each log as line (line.id)}
          <li class={line.tone === 'good' ? 'text-ok' : line.tone === 'bad' ? 'text-bad' : 'text-ink-dim'}>{line.text()}</li>
        {/each}
      </ol>
    </section>
  {/if}
</main>
