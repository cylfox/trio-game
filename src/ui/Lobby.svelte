<script lang="ts">
  // The lobby: title, name, then two distinct blocks: "Play with a friend" (Create room, Join
  // with code, or the room panel once a room is open) and "Train solo" (countdown, Start). Below
  // them "What's a trio?" (always starts collapsed), "How to play" and the footer links.
  import { fitCard } from '../game/card-html.ts';
  import { LOGO_CARDS } from '../game/examples.ts';
  import { T, anim } from '../game/motion.ts';
  import { TRAIN_COUNTS, saveTrainCount } from '../game/prefs.ts';
  import type { TrainCount } from '../game/prefs.ts';
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { normalizeCode } from '../lib/net/room-code.ts';
  import type { SessionState } from '../lib/net/session.ts';
  import { enter } from './attach.ts';
  import CardFace from './CardFace.svelte';
  import FooterLinks from './FooterLinks.svelte';
  import HowTo from './HowTo.svelte';
  import Learn from './Learn.svelte';
  import PixelIcon from './PixelIcon.svelte';
  import RoomPanel from './RoomPanel.svelte';
  import type { ConnectIssue, RoomNet } from './types.ts';
  import Section from './Section.svelte';
  import Toggles from './Toggles.svelte';

  interface Props {
    name: string;
    trainCount: TrainCount;
    snap: SessionState | null;
    me: string;
    invite: string;
    issue: ConnectIssue;
    net: RoomNet | null;
    busy: boolean;
    ontrain: () => void;
    oncreate: () => void;
    onjoin: (code: string) => void;
    onleave: () => void;
    onretry: () => void;
    onstart: () => void;
    onname: (name: string) => void;
  }

  let { name = $bindable(), trainCount = $bindable(), snap, me, invite, issue, net, busy, ontrain, oncreate, onjoin, onleave, onretry, onstart, onname }: Props = $props();

  let joinCode = $state('');
  let badCode = $state(false);
  const inRoom = $derived(snap !== null && snap.role !== 'train');

  // Short phones (360×640): a smaller logo, so Create room and Join fit above the fold.
  const shortQuery = typeof matchMedia === 'function' ? matchMedia('(max-height: 700px)') : null;
  let short = $state(shortQuery?.matches ?? false);
  $effect(() => {
    if (!shortQuery) return;
    const on = (e: MediaQueryListEvent) => (short = e.matches);
    shortQuery.addEventListener('change', on);
    return () => shortQuery.removeEventListener('change', on);
  });
  // The logo cards are board cards (CardFace), fitted so their symbols keep the board's proportion.
  const logoW = $derived(fitCard(short ? 30 : 50).w);

  function pickCount(n: TrainCount, el: HTMLElement): void {
    trainCount = n;
    saveTrainCount(n);
    play('toggle');
    void anim(el, [{ transform: 'scale(.85)' }, { transform: 'scale(1.08)', offset: 0.6 }, { transform: 'none' }], { duration: T(260), easing: 'ease-out' });
  }

  function onCodeInput(): void {
    const v = joinCode
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
    if (v !== joinCode) joinCode = v;
    badCode = false;
  }

  function join(e: SubmitEvent): void {
    e.preventDefault();
    if (joinCode.length !== 4) return;
    const code = normalizeCode(joinCode);
    if (code === null) {
      badCode = true;
      play('error');
      return;
    }
    play('ui');
    onjoin(code);
  }
</script>

<section class="screen scr-lobby" aria-label={t('aria.lobby')} {@attach enter('screen')}>
  <div class="lobby">
    <Toggles links />
    <header class="logo">
      <h1 class="title" aria-label={t('app.name')}>
        {#each t('app.name').split('') as ch, i (i)}<span style="--i:{i}" aria-hidden="true">{ch}</span>{/each}
      </h1>
      <div class="logo-cards" aria-hidden="true" style:height="{Math.ceil(logoW * 1.5 + 10)}px">
        {#each LOGO_CARDS as card, k (card)}
          <CardFace {card} width={logoW} class="logo-card" style="--i:{k};--dx:{((k - 1) * logoW * 0.88).toFixed(1)}px;--r:{(k - 1) * 10}deg" />
        {/each}
      </div>
      <p class="tagline">{t('lobby.tagline')}</p>
    </header>

    <div class="slab name-card">
      <label class="field-label" for="name">{t('name.label')}</label>
      <input
        class="field"
        id="name"
        type="text"
        maxlength="12"
        placeholder={t('lobby.namePh')}
        autocomplete="nickname"
        spellcheck="false"
        disabled={inRoom}
        bind:value={name}
        oninput={() => onname(name)}
      />
    </div>

    <!-- Play with a friend: the primary block (gold). -->
    <section class="slab mode mode-online" aria-labelledby="online-h">
      <div class="mode-head">
        <span class="mode-icon" aria-hidden="true"><PixelIcon name="players" size={0.9} /></span>
        <div class="mode-txt">
          <h2 class="mode-title" id="online-h">{t('menu.online')}</h2>
          {#if !inRoom}<p class="mode-sub">{t('lobby.onlineSub')}</p>{/if}
        </div>
      </div>
      {#if inRoom && snap !== null}
        <RoomPanel {snap} {me} myName={name} {invite} {issue} {net} {onleave} {onretry} {onstart} />
      {:else}
        <button class="btn btn-wide btn-big" type="button" disabled={busy} onclick={() => (play('ui'), oncreate())}>{t('menu.create')}</button>
        <form onsubmit={join}>
          <label class="field-label" for="join-code">{t('menu.join')}</label>
          <div class="join-row">
            <input
              class="field"
              id="join-code"
              type="text"
              maxlength="4"
              placeholder={t('lobby.codePh')}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              inputmode="text"
              aria-invalid={badCode}
              aria-describedby={badCode ? 'join-err' : undefined}
              bind:value={joinCode}
              oninput={onCodeInput}
            />
            <button class="btn {joinCode.length === 4 ? '' : 'btn-slate'}" type="submit" disabled={joinCode.length !== 4 || busy}>{t('lobby.join')}</button>
          </div>
          {#if badCode}<p class="field-error" id="join-err" role="alert">{t('menu.badCode')}</p>{/if}
        </form>
      {/if}
    </section>

    <!-- Train solo: the secondary block (cyan). Hidden while a room is open. -->
    {#if !inRoom}
      <section class="slab mode mode-train" aria-labelledby="train-h">
        <div class="mode-head">
          <span class="mode-icon" aria-hidden="true"><PixelIcon name="stopwatch" size={1} /></span>
          <div class="mode-txt">
            <h2 class="mode-title" id="train-h">{t('lobby.trainTitle')}</h2>
            <p class="mode-sub">{t('lobby.trainSub')}</p>
          </div>
        </div>
        <div class="tc-row" role="group" aria-labelledby="tc-label">
          <span class="field-label" id="tc-label">{t('lobby.countdown')}</span>
          <div class="tc-seg">
            {#each TRAIN_COUNTS as n (n)}
              <button
                class="btn btn-small {n === trainCount ? 'btn-cyan' : 'btn-slate'}"
                type="button"
                aria-pressed={n === trainCount}
                onclick={(e) => pickCount(n, e.currentTarget)}>{n ? t('lobby.secs', { n }) : t('lobby.cdOff')}</button
              >
            {/each}
          </div>
        </div>
        <button class="btn btn-slate btn-wide" type="button" disabled={busy} onclick={() => (play('ui'), ontrain())}>{t('lobby.trainStart')}</button>
      </section>
    {/if}

    <Section id="learn" title={t('learn.title')}><Learn /></Section>
    <Section id="howto" title={t('howto.title')}><HowTo /></Section>
    <footer class="lobby-foot"><FooterLinks note /></footer>
  </div>
</section>
