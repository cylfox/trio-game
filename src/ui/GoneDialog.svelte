<script lang="ts">
  // Versus: the other player is gone mid-game (left on purpose, or lost connection) and the game
  // is paused. Wait for them (their seat and score are kept; the dialog closes by itself when they
  // come back) or leave the room. A tap outside does not close it: it can pop up under a finger
  // that was going for a card.
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { enter } from './attach.ts';

  interface Props {
    name: string;
    /** Left on purpose, rather than lost connection. */
    quit: boolean;
    onwait: () => void;
    onleave: () => void;
  }

  let { name, quit, onwait, onleave }: Props = $props();
</script>

<div class="modal">
  <div class="slab modal-card" role="alertdialog" aria-modal="true" aria-labelledby="gone-title" aria-describedby="gone-body" {@attach enter('modal')}>
    <h2 id="gone-title">{quit ? t('gone.titleQuit') : t('gone.titleAway')}</h2>
    <p id="gone-body" class="modal-confirm">{quit ? t('gone.bodyQuit', { name }) : t('gone.bodyAway', { name })}</p>
    <!-- svelte-ignore a11y_autofocus -->
    <button class="btn btn-wide" type="button" onclick={() => (play('ui'), onwait())} autofocus>{t('gone.wait')}</button>
    <button class="btn btn-red btn-wide" type="button" onclick={() => (play('ui'), onleave())}>{t('gmenu.leaveRoom')}</button>
  </div>
</div>
