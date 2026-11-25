<script lang="ts">
  // The top bar: the sound switch and the language menu (lobby and game menu). With `links` (the
  // lobby) it also holds icon-only Ko-fi and GitHub links on the left; the footer keeps its own.
  import { play, sound } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { GITHUB_MARK, KOFI_URL, REPO_URL } from './icons.ts';
  import LangMenu from './LangMenu.svelte';
  import PixelIcon from './PixelIcon.svelte';

  let { links = false }: { links?: boolean } = $props();

  let soundOn = $state(sound.enabled);

  function toggleSound(): void {
    soundOn = !soundOn;
    sound.setEnabled(soundOn);
    play('toggle');
  }
</script>

<div class="lang" class:with-links={links}>
  {#if links}
    <div class="top-links">
      <a class="btn btn-small top-link kofi" href={KOFI_URL} target="_blank" rel="noopener noreferrer" aria-label={t('kofi.aria')} title={t('kofi.label')}>
        <PixelIcon name="coffee" size={1} />
      </a>
      <a class="btn btn-small btn-slate top-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('gh.aria')} title={t('gh.label')}>
        <svg class="gh-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={GITHUB_MARK} /></svg>
      </a>
    </div>
  {/if}
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
  <LangMenu />
</div>
