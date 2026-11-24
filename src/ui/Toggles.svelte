<script lang="ts">
  // The language switch (EN/ES) and the sound switch, side by side (lobby and menu).
  import { play, sound } from '../lib/audio/index.ts';
  import { LANGS } from '../lib/i18n/index.ts';
  import { locale, setLang, t } from '../lib/i18n/locale.svelte.ts';
  import PixelIcon from './PixelIcon.svelte';

  let soundOn = $state(sound.enabled);

  function toggleSound(): void {
    soundOn = !soundOn;
    sound.setEnabled(soundOn);
    play('toggle');
  }

  function pickLang(lang: (typeof LANGS)[number]): void {
    if (lang === locale.lang) return;
    setLang(lang);
    play('toggle');
  }
</script>

<div class="lang">
  <button
    class="btn btn-small btn-snd {soundOn ? '' : 'btn-slate'}"
    type="button"
    aria-pressed={soundOn}
    aria-label={soundOn ? t('sound.on') : t('sound.off')}
    title={t('sound.label')}
    onclick={toggleSound}
  >
    <PixelIcon name={soundOn ? 'speaker' : 'speakerOff'} size={0.85} />
  </button>
  <div class="lang-group" role="group" aria-label={t('lang.label')}>
    {#each LANGS as lang (lang)}
      <button class="btn btn-small {locale.lang === lang ? '' : 'btn-slate'}" type="button" aria-pressed={locale.lang === lang} onclick={() => pickLang(lang)}
        >{lang.toUpperCase()}</button
      >
    {/each}
  </div>
</div>

<style>
  .lang-group {
    display: flex;
    gap: 6px;
  }
  .btn-snd {
    margin-right: 6px;
  }
</style>
