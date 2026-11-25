<script lang="ts">
  // The language control (lobby top bar and game menu): a chunky button with the pixel globe and
  // the current language's initials ("EN" / "ES") that opens a small listbox with English and
  // Español, the current one checked. Keyboard: Enter / Space / ↓ / ↑ open it, the arrows (and
  // Home / End) move, Enter / Space pick, Escape closes it and Tab leaves it; a tap outside closes
  // it. The choice is saved by setLang().
  import { tick } from 'svelte';
  import { play } from '../lib/audio/index.ts';
  import { LANGS } from '../lib/i18n/index.ts';
  import type { Lang } from '../lib/i18n/index.ts';
  import { locale, setLang, t } from '../lib/i18n/locale.svelte.ts';
  import PixelIcon from './PixelIcon.svelte';

  /** Room the list needs below the button before it opens upwards instead (px). */
  const LIST_ROOM = 120;

  const uid = `lang-${Math.random().toString(36).slice(2, 8)}`;
  let open = $state(false);
  let up = $state(false);
  let active = $state(0);
  let root: HTMLElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  const nameOf = (lang: Lang): string => t(`lang.${lang}`);
  const current = $derived(LANGS.indexOf(locale.lang));

  function focusActive(): void {
    list?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }

  async function show(at: number): Promise<void> {
    if (button) {
      // Open upwards when the list wouldn't fit below (the game menu's card scrolls and clips).
      const bottom = button.closest('.modal-card')?.getBoundingClientRect().bottom ?? innerHeight;
      up = button.getBoundingClientRect().bottom + LIST_ROOM > bottom;
    }
    active = at;
    open = true;
    play('ui');
    await tick();
    focusActive();
  }

  function hide(refocus: boolean): void {
    open = false;
    if (refocus) button?.focus();
  }

  function choose(lang: Lang): void {
    hide(true);
    if (lang === locale.lang) return;
    setLang(lang);
    play('toggle');
  }

  function onButtonKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void show(e.key === 'ArrowUp' ? LANGS.length - 1 : current);
    }
  }

  function onListKey(e: KeyboardEvent): void {
    const n = LANGS.length;
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: n - 1 };
    if (e.key in moves) {
      e.preventDefault();
      active = (moves[e.key] + n) % n;
      focusActive();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(LANGS[active]);
    } else if (e.key === 'Escape') {
      // Only the list closes: the game menu around it stays open.
      e.preventDefault();
      e.stopPropagation();
      hide(true);
    } else if (e.key === 'Tab') {
      hide(false);
    }
  }

  // A tap anywhere outside closes the list.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) hide(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });
</script>

<div class="lang-menu" bind:this={root}>
  <button
    class="btn btn-small btn-slate lang-btn"
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `${uid}-list` : undefined}
    aria-label={t('lang.current', { name: nameOf(locale.lang) })}
    title={t('lang.label')}
    bind:this={button}
    onclick={() => (open ? hide(false) : show(current))}
    onkeydown={onButtonKey}
  >
    <span class="lang-globe"><PixelIcon name="globe" size={1} /></span>
    <span>{locale.lang.toUpperCase()}</span>
  </button>
  {#if open}
    <div class="slab lang-pop" class:up id="{uid}-list" role="listbox" tabindex="-1" aria-label={t('lang.label')} bind:this={list} onkeydown={onListKey}>
      {#each LANGS as lang, i (lang)}
        <button class="lang-opt" type="button" role="option" lang={lang} aria-selected={lang === locale.lang} tabindex="-1" onclick={() => choose(lang)} onfocus={() => (active = i)}>
          <span>{nameOf(lang)}</span>
          {#if lang === locale.lang}<PixelIcon name="check" size={0.75} />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
