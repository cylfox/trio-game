/**
 * Translation core: pure functions, no DOM. The Svelte-facing wrapper is locale.svelte.ts.
 *   translate(lang, key, params)  {name} interpolation, plurals by `count`, numbers via Intl
 *   formatSeconds(lang, ms)       "1.84 s" / "1,84 s"
 *   detectLang(navigator.languages)
 */
import { cardNames } from '../engine/engine.ts';
import type { CardId } from '../engine/engine.ts';
import { en, enCardLabel } from './en.ts';
import type { MessageKey, Messages } from './en.ts';
import { es, esCardLabel } from './es.ts';
import type { CardLabeler, Message } from './types.ts';

export type { MessageKey } from './en.ts';

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

const MESSAGES: Record<Lang, Messages> = { en, es };
const CARD_LABELS: Record<Lang, CardLabeler> = { en: enCardLabel, es: esCardLabel };

export type Params = Readonly<Record<string, string | number>>;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** The first preferred language we support decides; anything else falls back to English. */
export function detectLang(languages: readonly string[]): Lang {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'es') return 'es';
    if (base === 'en') return 'en';
  }
  return 'en';
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<Lang, Intl.PluralRules>();

export function formatNumber(lang: Lang, value: number, options: Intl.NumberFormatOptions = {}): string {
  const key = `${lang}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(lang, options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Milliseconds as seconds with `digits` decimals: "1.84 s" (en), "1,84 s" (es). */
export function formatSeconds(lang: Lang, ms: number, digits = 2): string {
  const seconds = formatNumber(lang, ms / 1000, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${seconds} s`;
}

function pick(lang: Lang, message: Message, count: unknown): string {
  if (typeof message === 'string') return message;
  if (typeof count !== 'number') return message.other;
  let rules = pluralRules.get(lang);
  if (rules === undefined) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return message[rules.select(count)] ?? message.other;
}

/** Fill {placeholders}; numbers are formatted for `lang`. Unknown placeholders stay visible. */
export function interpolate(lang: Lang, text: string, params: Params = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? formatNumber(lang, value) : value;
  });
}

export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  return interpolate(lang, pick(lang, MESSAGES[lang][key], params.count), params);
}

/** A card's accessible name in `lang`. */
export function cardLabel(lang: Lang, id: CardId): string {
  return CARD_LABELS[lang](cardNames(id));
}

/** For tests and tooling. */
export function messages(lang: Lang): Messages {
  return MESSAGES[lang];
}
