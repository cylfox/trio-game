<script lang="ts">
  // The room inside the lobby card: code tiles, invite (share or copy), seats, status, Start,
  // and the error states (room full, version, closed, can't connect).
  import { T, S, anim, popIn } from '../game/motion.ts';
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { MIN_PLAYERS } from '../lib/net/protocol.ts';
  import type { SessionState } from '../lib/net/session.ts';
  import { toast } from './toasts.svelte.ts';
  import type { ConnectIssue } from './types.ts';

  interface Props {
    snap: SessionState;
    me: string;
    myName: string;
    invite: string;
    issue: ConnectIssue;
    onleave: () => void;
    onretry: () => void;
    onstart: () => void;
  }

  let { snap, me, myName, invite, issue, onleave, onretry, onstart }: Props = $props();

  let inviteEl: HTMLInputElement | undefined = $state();
  let copied = $state(false);
  let starting = $state(false);

  const room = $derived(snap.room);
  const isHost = $derived(snap.role === 'host');
  const code = $derived(snap.code ?? '');
  const seats = $derived(room?.seats ?? []);
  const others = $derived(seats.filter((s) => s.id !== me));
  const other = $derived(others[0]);
  const hostSeat = $derived(seats.find((s) => s.id === room?.hostId));
  const canStart = $derived(isHost && room !== null && room.seats.length >= MIN_PLAYERS && room.seats.every((s) => s.connected));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const canShare = coarse && typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const fatal = $derived.by((): { title: string; body: string; tip?: string; retry: boolean } | null => {
    if (snap.status === 'denied') {
      if (snap.denied === 'version') return { title: t('err.versionTitle'), body: t('deny.version'), retry: false };
      if (snap.denied === 'duplicate') return { title: t('err.duplicateTitle'), body: t('deny.duplicate'), retry: false };
      return { title: t('deny.full'), body: t('deny.fullDetail', { count: room?.maxPlayers ?? 2 }), retry: false };
    }
    if (snap.status === 'closed') return { title: t('err.closedTitle'), body: t('err.closedBody'), retry: false };
    if (issue === 'noAnswer' && snap.status === 'connecting') return { title: t('err.connectTitle'), body: t('err.noAnswerBody', { code }), tip: t('err.connectTip'), retry: true };
    if (issue === 'peer' && snap.status === 'connecting') return { title: t('err.connectTitle'), body: t('err.connectBody'), retry: true };
    return null;
  });
  /** The host keeps its room open: the error is a notice above it. */
  const hostNotice = $derived(isHost && issue === 'peer' && !canStart);

  const nameOf = (id: string, name: string) => name || (id === me ? myName || t('lobby.defaultName') : t('player.unnamed', { tag: id.slice(0, 4).toUpperCase() }));

  function tilesIn(node: HTMLElement): void {
    Array.from(node.children).forEach((x, i) =>
      anim(
        x,
        [
          { transform: 'translateY(-20px) scale(.5)', opacity: 0 },
          { transform: 'translateY(3px) scale(1.08)', opacity: 1, offset: 0.6 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: T(380), delay: S(i * 70), easing: 'ease-out', fill: 'backwards' },
      ),
    );
  }

  function selectFallback(): void {
    inviteEl?.focus();
    inviteEl?.select();
    try {
      inviteEl?.setSelectionRange(0, invite.length);
    } catch {
      // ignore
    }
    toast(t('toast.linkSelect'), 'info', 1800);
  }

  async function shareInvite(): Promise<void> {
    play('ui');
    if (canShare) {
      try {
        await navigator.share({ title: t('app.name'), text: t('room.shareText', { code }), url: invite });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(invite);
      copied = true;
      toast(t('toast.linkCopied'), 'gold', 1400);
      setTimeout(() => (copied = false), 1600);
    } catch {
      selectFallback();
    }
  }

  function start(): void {
    if (starting || !canStart) return;
    starting = true;
    play('ui');
    onstart();
    setTimeout(() => (starting = false), 1500);
  }
</script>

<div class="room">
  <div class="room-head">
    <span class="field-label">{isHost ? t('room.yourCode') : t('room.joinedRoom')}</span>
    <button class="linkbtn" type="button" onclick={() => (play('ui'), onleave())}>{t('room.leave')}</button>
  </div>

  {#if fatal}
    <div class="err" role="alert">
      <p class="err-title">{fatal.title}</p>
      <p class="err-body">{fatal.body}</p>
      {#if fatal.tip}<p class="err-tip">{fatal.tip}</p>{/if}
      <div class="err-actions">
        {#if fatal.retry}<button class="btn btn-cyan btn-small" type="button" onclick={() => (play('ui'), onretry())}>{t('err.retry')}</button>{/if}
        <button class="btn btn-slate btn-small" type="button" onclick={() => (play('ui'), onleave())}>{t('err.back')}</button>
      </div>
    </div>
  {:else}
    {#if hostNotice}
      <div class="err" role="alert">
        <p class="err-title">{t('err.connectTitle')}</p>
        <p class="err-body">{t('err.connectBody')}</p>
      </div>
    {/if}
    <div class="code" role="img" aria-label={t('room.codeAria', { code: code.split('').join(' ') })} {@attach tilesIn}>
      {#each code.split('') as ch, i (i)}<span class="code-tile">{ch}</span>{/each}
    </div>
    <div class="invite">
      <input class="field" type="text" readonly value={invite} aria-label={t('room.invite')} bind:this={inviteEl} />
      <button class="btn btn-small btn-slate" type="button" onclick={shareInvite}>{canShare ? t('room.share') : copied ? t('room.copied') : t('room.copyLink')}</button>
    </div>
    {#if room !== null}
      <div class="seats">
        {#if isHost}
          <div class="seat" style="--sc:var(--you)"><i></i><span>{nameOf(me, myName)}</span><em>{t('seat.host')}</em></div>
          {#if other}
            <div class="seat" class:away={!other.connected} style="--sc:var(--partner)" {@attach popIn}>
              <i></i><span>{nameOf(other.id, other.name)}</span><em>{other.connected ? t('seat.joined') : t('seat.away')}</em>
            </div>
          {:else}
            <div class="seat empty"><i></i><span>{t('seat.empty')}</span></div>
          {/if}
        {:else}
          {#if hostSeat}
            <div class="seat" class:away={!hostSeat.connected} style="--sc:var(--partner)"><i></i><span>{nameOf(hostSeat.id, hostSeat.name)}</span><em>{t('seat.host')}</em></div>
          {/if}
          <div class="seat" style="--sc:var(--you)"><i></i><span>{nameOf(me, myName)}</span><em>{t('seat.you')}</em></div>
        {/if}
      </div>
    {/if}
    <div class="status" role="status">
      {#if snap.status === 'connecting'}
        {t('room.connecting', { code })}<span class="dots"><i>.</i><i>.</i><i>.</i></span>
      {:else if snap.status === 'hostAway'}
        {t('room.hostAway')}<span class="dots"><i>.</i><i>.</i><i>.</i></span>
      {:else if isHost}
        {#if !other}{t('room.waiting')}<span class="dots"><i>.</i><i>.</i><i>.</i></span>{:else if other.connected}{t('room.ready', {
            name: nameOf(other.id, other.name),
          })}{:else}{t('room.notReady', { name: nameOf(other.id, other.name) })}{/if}
      {:else}
        {t('room.waitHost', { name: hostSeat ? nameOf(hostSeat.id, hostSeat.name) : '' })}<span class="dots"><i>.</i><i>.</i><i>.</i></span>
      {/if}
    </div>
    {#if isHost && canStart}
      <button class="btn btn-wide btn-big" type="button" disabled={starting} onclick={start} {@attach popIn}>{t('room.start')}</button>
    {/if}
  {/if}
</div>
