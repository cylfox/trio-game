<script lang="ts">
  // The lobby: title, name, Train (with its countdown), Create room, Join with code, the room
  // panel once a room is open, "What's a set?", "How to play" and the footer links.
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
  import RoomPanel from './RoomPanel.svelte';
  import type { ConnectIssue } from './types.ts';
  import Section from './Section.svelte';
  import Toggles from './Toggles.svelte';

  interface Props {
    name: string;
    trainCount: TrainCount;
    snap: SessionState | null;
    me: string;
    invite: string;
    issue: ConnectIssue;
    busy: boolean;
    ontrain: () => void;
    oncreate: () => void;
    onjoin: (code: string) => void;
    onleave: () => void;
    onretry: () => void;
    onstart: () => void;
    onname: (name: string) => void;
  }

  let { name = $bindable(), trainCount = $bindable(), snap, me, invite, issue, busy, ontrain, oncreate, onjoin, onleave, onretry, onstart, onname }: Props = $props();

  let joinCode = $state('');
  let badCode = $state(false);
  const inRoom = $derived(snap !== null && snap.role !== 'train');

  // Short phones (360×640): a smaller logo, so Train, Create and Join fit above the fold.
  const shortQuery = typeof matchMedia === 'function' ? matchMedia('(max-height: 700px)') : null;
  let short = $state(shortQuery?.matches ?? false);
  $effect(() => {
    if (!shortQuery) return;
    const on = (e: MediaQueryListEvent) => (short = e.matches);
    shortQuery.addEventListener('change', on);
    return () => shortQuery.removeEventListener('change', on);
  });
  const logoW = $derived(short ? 30 : 50);

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
    <Toggles />
    <header class="logo">
      <h1 class="title" aria-label={t('app.name')}>
        {#each t('app.name').split('') as ch, i (i)}<span style="--i:{i}" aria-hidden="true">{ch}</span>{/each}
      </h1>
      <div class="logo-cards" aria-hidden="true">
        {#each LOGO_CARDS as card, k (card)}
          <CardFace
            {card}
            width={logoW}
            class="logo-card"
            style="font-size:{logoW}px;--i:{k};--dx:{(k - 1) * (short ? 27 : 44)}px;--r:{(k - 1) * 10}deg"
          />
        {/each}
      </div>
      <p class="tagline">{t('lobby.tagline')}</p>
    </header>

    <div class="slab lobby-card">
      <div>
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

      {#if inRoom && snap !== null}
        <RoomPanel {snap} {me} myName={name} {invite} {issue} {onleave} {onretry} {onstart} />
      {:else}
        <div class="room">
          <div class="train-group">
            <button class="btn btn-slate btn-wide btn-big" type="button" disabled={busy} onclick={() => (play('ui'), ontrain())}>
              <span class="stack"><span>{t('menu.train')}</span><small>{t('lobby.trainSub')}</small></span>
            </button>
            <div class="tc-row" role="group" aria-labelledby="tc-label">
              <span class="field-label" id="tc-label">{t('lobby.countdown')}</span>
              <div class="tc-seg">
                {#each TRAIN_COUNTS as n (n)}
                  <button
                    class="btn btn-small {n === trainCount ? '' : 'btn-slate'}"
                    type="button"
                    aria-pressed={n === trainCount}
                    onclick={(e) => pickCount(n, e.currentTarget)}>{n ? t('lobby.secs', { n }) : t('lobby.cdOff')}</button
                  >
                {/each}
              </div>
            </div>
          </div>
          <div class="or">{t('menu.online')}</div>
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
              <button class="btn btn-cyan" type="submit" disabled={joinCode.length !== 4 || busy}>{t('lobby.join')}</button>
            </div>
            {#if badCode}<p class="field-error" id="join-err" role="alert">{t('menu.badCode')}</p>{/if}
          </form>
        </div>
      {/if}
    </div>

    <Section id="learn" title={t('learn.title')} open><Learn /></Section>
    <Section id="howto" title={t('howto.title')}><HowTo /></Section>
    <footer class="lobby-foot"><FooterLinks note /></footer>
  </div>
</section>
