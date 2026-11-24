<script lang="ts">
  // "Rules" from the game menu: How to play and What's a set?, as a sheet over the game.
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { enter } from './attach.ts';
  import HowTo from './HowTo.svelte';
  import Learn from './Learn.svelte';
  import Section from './Section.svelte';

  let { onclose }: { onclose: () => void } = $props();

  function close(): void {
    play('ui');
    onclose();
  }

  function backdrop(e: PointerEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal rules" onpointerdown={backdrop}>
  <div class="rules-sheet" role="dialog" aria-modal="true" aria-label={t('gmenu.rules')} {@attach enter('modal')}>
    <div class="sheet-col">
      <Section id="r-howto" title={t('howto.title')} open><HowTo /></Section>
      <Section id="r-learn" title={t('learn.title')}><Learn /></Section>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn btn-wide" type="button" onclick={close} autofocus>{t('gmenu.resume')}</button>
    </div>
  </div>
</div>

<style>
  .sheet-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0 14px;
  }
</style>
