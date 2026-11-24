<script lang="ts">
  // Source and support links (lobby footer and game menu). The GitHub mark is the official one,
  // unmodified; the Ko-fi link has its own pixel coffee cup (not Ko-fi's logo).
  import { t } from '../lib/i18n/locale.svelte.ts';
  import { GITHUB_MARK, KOFI_URL, REPO_URL } from './icons.ts';
  import PixelIcon from './PixelIcon.svelte';

  let { note = false }: { note?: boolean } = $props();
</script>

<div class="links">
  <div class="row">
    <a class="btn btn-small btn-slate link" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('gh.aria')}>
      <svg class="gh-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={GITHUB_MARK} /></svg>
      <span>{t('gh.label')}</span>
    </a>
    <a class="btn btn-small link kofi" href={KOFI_URL} target="_blank" rel="noopener noreferrer" aria-label={t('kofi.aria')}>
      <PixelIcon name="coffee" size={0.9} />
      <span>{t('kofi.label')}</span>
    </a>
  </div>
  {#if note}<p class="fineprint">{t('gh.note')}</p>{/if}
</div>

<style>
  .links {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .link {
    text-decoration: none;
    font-size: 19px;
    min-height: 38px;
    padding: 6px 11px 8px;
  }
  .link:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
  }
  .gh-mark {
    width: 18px;
    height: 18px;
    flex: none;
  }
  /* A warm accent, quieter than the game's main buttons: a footer link, not a call to action. */
  .kofi {
    --c: var(--slab-2);
    --l: var(--you-dim);
    --t: var(--you);
    border: 2px solid var(--you-dim);
  }
</style>
