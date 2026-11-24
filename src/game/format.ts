/**
 * Number and time formatting for the game UI (pure, no DOM).
 *   fmtSpot   spot / pick times: 2 decimals under 10 s, 1 decimal under a minute, then m:ss
 *   fmtClock  elapsed game time as mm:ss
 *   splitUnits  finds the "s" unit after a number so the UI can keep it lowercase inside
 *               uppercase labels ("TRAINING · 3 s COUNTDOWN")
 */
import type { Lang } from '../lib/i18n/index.ts';

const formats = new Map<string, Intl.NumberFormat>();

/** A fixed-decimals number without grouping: 1.84 (en), 1,84 (es). */
export function fmtFixed(lang: Lang, value: number, decimals: number): string {
  const key = `${lang}|${decimals}`;
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
    formats.set(key, format);
  }
  return format.format(value);
}

/** Truncated, never rounded up, so a running clock never shows a value it has not reached. */
export function fmtSpot(lang: Lang, ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return fmtFixed(lang, Math.floor(s * 100) / 100, 2);
  if (s < 60) return fmtFixed(lang, Math.floor(s * 10) / 10, 1);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** fmtSpot with the unit: "1.84 s". Minutes (m:ss) and the dash have no unit. */
export function fmtSpotU(lang: Lang, ms: number | null | undefined): string {
  const value = fmtSpot(lang, ms);
  return value === '–' || (ms ?? 0) >= 60_000 ? value : `${value} s`;
}

/** Elapsed time as mm:ss (minutes keep growing past 99). */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** A score with a real minus sign. */
export function fmtScore(score: number): string {
  return score < 0 ? `−${-score}` : String(score);
}

export interface TextSegment {
  readonly text: string;
  /** true for a seconds unit ("s") that must stay lowercase. */
  readonly unit: boolean;
}

// A lone "s" right after a number ("3 s", "1,84 s", "5s"), not the start of a word ("3 sets").
const UNIT = /(\d)(\s?)s(?![\p{L}\p{N}])/gu;

/** Split text so every seconds unit is its own segment. */
export function splitUnits(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(UNIT)) {
    const unitAt = (match.index ?? 0) + match[1].length + match[2].length;
    if (unitAt > last) out.push({ text: text.slice(last, unitAt), unit: false });
    out.push({ text: 's', unit: true });
    last = unitAt + 1;
  }
  if (last < text.length) out.push({ text: text.slice(last), unit: false });
  return out;
}
