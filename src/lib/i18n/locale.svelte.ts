/**
 * The app's current language, reactive for Svelte. t() reads it, so markup re-renders on switch.
 * Choice order: the saved choice (localStorage, if any), then navigator.languages (es* → Spanish,
 * anything else → English). <html lang> follows.
 */
import { browserStore } from '../net/storage.ts';
import { cardLabel as cardLabelIn, detectLang, formatSeconds as formatSecondsIn, isLang, translate } from './index.ts';
import type { Lang, MessageKey, Params } from './index.ts';
import type { CardId } from '../engine/engine.ts';

const LANG_KEY = 'trio:lang';
const store = browserStore();

function initialLang(): Lang {
  const saved = store.get(LANG_KEY);
  if (isLang(saved)) return saved;
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return detectLang(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}

export const locale = $state<{ lang: Lang }>({ lang: initialLang() });

function syncHtml(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale.lang;
}
syncHtml();

export function setLang(lang: Lang): void {
  locale.lang = lang;
  store.set(LANG_KEY, lang);
  syncHtml();
}

export function t(key: MessageKey, params?: Params): string {
  return translate(locale.lang, key, params);
}

export function seconds(ms: number, digits?: number): string {
  return formatSecondsIn(locale.lang, ms, digits);
}

export function cardName(id: CardId): string {
  return cardLabelIn(locale.lang, id);
}
