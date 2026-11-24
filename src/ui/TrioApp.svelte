<script lang="ts">
  // The app shell: backdrop and frame, screens (lobby → game → results), the session and its
  // controller, invite links, toasts, the live region, wake lock and visibility handling.
  import { onMount } from 'svelte';
  import { GameController } from '../game/controller.svelte.ts';
  import { loadTrainCount } from '../game/prefs.ts';
  import { installAudio, play } from '../lib/audio/index.ts';
  import { isMessageKey } from '../lib/i18n/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { createWakeLock } from '../lib/net/lifecycle.ts';
  import { codeFromHash, inviteLink } from '../lib/net/room-code.ts';
  import type { Change, RoomSession, SessionState } from '../lib/net/session.ts';
  import { browserStore, forgetRoom, loadIdentity, saveName } from '../lib/net/storage.ts';
  import { createTrain } from '../lib/net/train.ts';
  import Game from './Game.svelte';
  import Lobby from './Lobby.svelte';
  import Results from './Results.svelte';
  import { announce, toast, ui } from './toasts.svelte.ts';
  import type { ConnectIssue } from './types.ts';

  type Screen = 'lobby' | 'game' | 'results';

  /** A guest still looking for the host after this long sees the "can't connect" help. */
  const CONNECT_PATIENCE_MS = 15_000;

  const store = browserStore();
  const wake = createWakeLock();
  const appUrl = new URL(import.meta.env.BASE_URL, location.origin).href;

  const initial = loadIdentity(store);
  let identity = $state(initial);
  let name = $state(initial.name);
  let trainCount = $state(loadTrainCount());
  let session = $state.raw<RoomSession | null>(null);
  let snap = $state.raw<SessionState | null>(null);
  let ctl = $state.raw<GameController | null>(null);
  let screen = $state<Screen>('lobby');
  let issue = $state<ConnectIssue>(null);
  let busy = $state(false);
  let unsubscribe: (() => void) | null = null;
  let connectTimer = 0;

  const invite = $derived(snap?.code ? inviteLink(appUrl, snap.code) : '');

  function nameOf(id: string, fallback: string): string {
    return fallback || ctl?.nameOf(id) || t('player.unnamed', { tag: id.slice(0, 4).toUpperCase() });
  }

  function why(reason: string): string {
    const key = `why.${reason}`;
    return isMessageKey(key) ? t(key) : reason;
  }

  function saveMyName(): void {
    identity = saveName(store, name);
  }

  function ensureController(s: RoomSession): GameController {
    if (ctl === null) {
      ctl = new GameController({
        session: s,
        me: identity.id,
        myName: () => identity.name,
        onOver: () => {
          if (ctl !== null) screen = 'results';
        },
      });
    }
    return ctl;
  }

  function route(state: SessionState, change: Change): void {
    if (change.type !== 'state') return;
    const startsGame = change.events.some((e) => e.type === 'newGame');
    if (state.role === 'train') {
      if (startsGame) screen = 'game';
      return;
    }
    if (state.status === 'denied' || state.status === 'closed') {
      ctl?.destroy();
      ctl = null;
      screen = 'lobby';
      return;
    }
    const phase = state.room?.phase;
    if (state.view !== null && (phase === 'playing' || phase === 'over')) {
      if (startsGame || screen === 'lobby') screen = 'game';
    }
  }

  function onChange(state: SessionState, change: Change): void {
    snap = state;
    if (state.status === 'online' && issue !== null) issue = null;
    if (session !== null && state.view !== null && state.status !== 'denied' && state.status !== 'closed') ensureController(session);
    ctl?.handle(state, change);
    route(state, change);
    switch (change.type) {
      case 'join':
        play('join');
        toast(t('toast.partnerJoined', { name: nameOf(change.playerId, change.name) }), 'partner', 1500);
        announce(t('toast.partnerJoined', { name: nameOf(change.playerId, change.name) }));
        return;
      case 'rejoin':
        play('join');
        toast(t('toast.partnerBack', { name: nameOf(change.playerId, change.name) }), 'partner', 1500);
        return;
      case 'leave':
        play('leave');
        toast(t('toast.partnerLeft', { name: nameOf(change.playerId, change.name) }), 'bad', 1800);
        announce(t('toast.partnerLeft', { name: nameOf(change.playerId, change.name) }));
        return;
      case 'hostAway':
        play('leave');
        toast(t('log.hostAway'), 'bad', 1800);
        return;
      case 'hostBack':
        play('join');
        toast(t('log.hostBack'), 'partner', 1500);
        return;
      case 'denied':
        play('error');
        if (change.playerId !== identity.id) toast(t('log.denied', { name: change.name || '?', reason: t(`reason.${change.reason}`) }), 'info', 2000);
        return;
      case 'closed':
        play('error');
        return;
      case 'error':
        if (change.code === 'peer-connect-failed') {
          issue = 'peer';
          play('error');
          if (screen !== 'lobby') toast(t('err.connectBody'), 'bad', 5000);
        }
        return;
      case 'rejected':
        if (change.intent === 'start' || change.intent === 'rematch') {
          play('error');
          toast(t('toast.refused', { reason: why(change.reason) }), 'bad', 1800);
        }
        return;
      case 'state':
        if (change.kind === 'snapshot' && state.role === 'guest' && state.room?.phase === 'lobby' && session && !joinedToast) {
          joinedToast = true;
          toast(t('toast.joinedRoom', { code: state.code ?? '' }), 'partner', 1500);
          play('join');
        }
        return;
    }
  }
  let joinedToast = false;

  function attach(next: RoomSession): void {
    unsubscribe?.();
    ctl?.destroy();
    ctl = null;
    issue = null;
    joinedToast = false;
    session = next;
    snap = next.getState();
    unsubscribe = next.subscribe(onChange);
    clearTimeout(connectTimer);
    if (next.role === 'guest') {
      connectTimer = window.setTimeout(() => {
        if (session === next && next.getState().status === 'connecting') {
          issue = issue ?? 'noAnswer';
          play('error');
        }
      }, CONNECT_PATIENCE_MS);
    }
    const state = next.getState();
    if (next.role === 'train' || state.view !== null) ensureController(next);
    // A resumed host: the game is already on.
    if (next.role === 'host' && state.view !== null && state.room?.phase !== 'lobby') screen = 'game';
  }

  function startTrain(): void {
    saveMyName();
    const config = trainCount === 0 ? { callMs: null } : { callMs: trainCount * 1000 };
    const s = createTrain({ playerId: identity.id, config });
    attach(s);
    // Start a fresh game now that we listen, so its deal animates from the deck.
    s.act({ type: 'start' });
  }

  async function openOnline(code: string | null): Promise<void> {
    if (busy) return;
    saveMyName();
    busy = true;
    try {
      // Trystero (WebRTC + Nostr signalling) loads only when a room is opened.
      const { openRoom } = await import('../lib/net/connect.ts');
      const opened = openRoom(code, identity, store);
      attach(opened.session);
      history.replaceState(null, '', `#${opened.code}`);
    } catch (err) {
      console.error(err);
      issue = 'noAnswer';
      toast(t('err.connectTitle'), 'bad', 2000);
    } finally {
      busy = false;
    }
  }

  async function leave(): Promise<void> {
    const s = session;
    const state = snap;
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(connectTimer);
    ctl?.destroy();
    ctl = null;
    session = null;
    snap = null;
    issue = null;
    screen = 'lobby';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (s !== null) await s.leave().catch(() => {});
    if (state?.role === 'host' && state.code !== null) forgetRoom(store, state.code);
  }

  async function retry(): Promise<void> {
    const code = snap?.code ?? null;
    await leave();
    if (code !== null) await openOnline(code);
  }

  // Keep the screen on during a game.
  $effect(() => {
    wake.set(screen === 'game');
  });

  // Back to the lobby: toasts sit at the top again.
  $effect(() => {
    if (screen !== 'game') ui.toastTop = 14;
  });

  onMount(() => {
    document.documentElement.classList.add('trio-ui');
    const offAudio = installAudio();
    const code = codeFromHash(location.hash);
    if (code !== null) void openOnline(code);
    const onHash = () => {
      const next = codeFromHash(location.hash);
      if (next !== null && next !== snap?.code) void leave().then(() => openOnline(next));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        session?.resync();
        ctl?.resumeSpot();
      } else ctl?.pauseSpot();
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVisibility);
      document.documentElement.classList.remove('trio-ui');
      offAudio();
      wake.destroy();
      void session?.leave();
    };
  });
</script>

<div class="backdrop" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i><i class="dither"></i></div>

<div class="frame">
  <div class="column">
    <div class="toasts" style:top="{ui.toastTop}px">
      {#each ui.toasts as item (item.id)}
        <div class="toast t-{item.kind}" class:leaving={item.leaving} role="status">{item.text}</div>
      {/each}
    </div>

    {#if screen === 'game' && ctl !== null}
      <Game {ctl} onleave={leave} />
    {:else if screen === 'results' && ctl !== null}
      <Results {ctl} onlobby={leave} />
    {:else}
      <Lobby
        bind:name
        bind:trainCount
        snap={snap !== null && snap.role !== 'train' ? snap : null}
        me={identity.id}
        {invite}
        {issue}
        {busy}
        ontrain={startTrain}
        oncreate={() => openOnline(null)}
        onjoin={(code) => openOnline(code)}
        onleave={leave}
        onretry={retry}
        onstart={() => session?.act({ type: 'start' })}
        onname={saveMyName}
      />
    {/if}

    <div class="sr-only" aria-live="polite" aria-atomic="true">{ui.said}</div>
  </div>
</div>

<div class="crt" aria-hidden="true"></div>

<style>
  .toast {
    animation: toastIn 0.32s ease-out;
    transition:
      opacity 0.22s,
      transform 0.22s;
  }
  .toast.leaving {
    opacity: 0;
    transform: translateY(-8px) scale(0.92);
  }
  @keyframes toastIn {
    from {
      transform: translateY(-14px) scale(0.7);
      opacity: 0;
    }
    60% {
      transform: translateY(0) scale(1.06);
      opacity: 1;
    }
    to {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation-duration: 0.14s;
    }
  }
</style>
