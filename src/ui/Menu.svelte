<script lang="ts">
  // The in-game menu: resume, end game (Train), new game (Train / host), rules, leave, language
  // and sound, and the footer links.
  import type { GameController } from '../game/controller.svelte.ts';
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { enter } from './attach.ts';
  import FooterLinks from './FooterLinks.svelte';
  import Toggles from './Toggles.svelte';

  interface Props {
    ctl: GameController;
    onclose: () => void;
    onrules: () => void;
    onleave: () => void;
  }

  let { ctl, onclose, onrules, onleave }: Props = $props();
  let confirming = $state(false);

  const canNewGame = $derived(ctl.isTrain || ctl.isHost);

  function backdrop(e: PointerEvent): void {
    if (e.target === e.currentTarget) onclose();
  }

  function act(fn: () => void): () => void {
    return () => {
      play('ui');
      fn();
    };
  }

  function newGame(): void {
    play('ui');
    onclose();
    ctl.session.act({ type: 'start' });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal" onpointerdown={backdrop}>
  <div class="slab modal-card" role="dialog" aria-modal="true" aria-labelledby="menu-title" {@attach enter('modal')}>
    <h2 id="menu-title">{t('gmenu.title')}</h2>
    {#if confirming}
      <p class="modal-confirm">{t('gmenu.newGameConfirm')}</p>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn btn-wide" type="button" onclick={newGame} autofocus>{t('gmenu.newGame')}</button>
      <button class="btn btn-slate btn-wide" type="button" onclick={act(() => (confirming = false))}>{t('err.back')}</button>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn btn-wide" type="button" onclick={act(onclose)} autofocus>{t('gmenu.resume')}</button>
      {#if ctl.isTrain && !ctl.ended}
        <button class="btn btn-slate btn-wide" type="button" onclick={act(() => (onclose(), ctl.endTrain()))}>{t('gmenu.endGame')}</button>
      {/if}
      {#if canNewGame}
        <button class="btn btn-slate btn-wide" type="button" onclick={act(() => (confirming = true))}>{t('gmenu.newGame')}</button>
      {/if}
      <button class="btn btn-slate btn-wide" type="button" onclick={act(onrules)}>{t('gmenu.rules')}</button>
      <button class="btn btn-red btn-wide" type="button" onclick={act(onleave)}>{ctl.isTrain ? t('gmenu.quitTraining') : t('gmenu.leaveRoom')}</button>
      <Toggles />
      <FooterLinks />
    {/if}
  </div>
</div>

<style>
  .modal-card {
    max-height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }
  @media (max-height: 700px) {
    .modal-card {
      gap: 10px;
      padding: 14px;
    }
    .modal-card h2 {
      font-size: 36px;
    }
  }
</style>
