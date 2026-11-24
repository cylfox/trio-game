/**
 * "What's a set?" examples and the lobby logo cards (pure). Card ids use the engine's layout
 * (shape*27 + color*9 + number*3 + shading); the mockup's ids were converted.
 */
import { decodeCard, encodeCard } from '../lib/engine/engine.ts';
import type { CardId, Rng } from '../lib/engine/engine.ts';

export type Trio = readonly [CardId, CardId, CardId];

/** The three fixed examples: same colour and shading, everything different, two green + one purple. */
export const EXAMPLES: readonly { readonly ids: Trio; readonly key: 'learn.ex1' | 'learn.ex2' | 'learn.ex3' }[] = [
  { ids: [0, 30, 60], key: 'learn.ex1' },
  { ids: [55, 14, 51], key: 'learn.ex2' },
  { ids: [12, 40, 77], key: 'learn.ex3' },
];

/** The fanned cards under the title: 1 red solid diamond, 2 green striped squiggles, 3 purple open ovals. */
export const LOGO_CARDS: Trio = [0, 40, 80];

export const FEATURES = ['shape', 'color', 'number', 'shading'] as const;
export type Feature = (typeof FEATURES)[number];

export interface Verdict {
  readonly feature: Feature;
  readonly ok: boolean;
  /** All three equal (only meaningful when ok). */
  readonly same: boolean;
  /** Index of the card that breaks a 2 + 1, or -1. */
  readonly odd: number;
}

/** Per feature: all same, all different, or 2 + 1 (with the odd card). */
export function judge(ids: Trio): Verdict[] {
  const f = ids.map(decodeCard);
  return FEATURES.map((feature) => {
    const [a, b, c] = f.map((x) => x[feature]);
    const same = a === b && b === c;
    const diff = a !== b && b !== c && a !== c;
    const odd = same || diff ? -1 : a === b ? 2 : a === c ? 1 : 0;
    return { feature, ok: same || diff, same, odd };
  });
}

export function isValid(ids: Trio): boolean {
  return judge(ids).every((v) => v.ok);
}

/** ~60% valid sets; otherwise exactly one feature broken (2 + 1). */
export function randomExample(rng: Rng = Math.random): Trio {
  const valid = rng() < 0.6;
  for (let n = 0; n < 60; n++) {
    const a = Math.floor(rng() * 81);
    const b = Math.floor(rng() * 81);
    if (a === b) continue;
    const da = decodeCard(a);
    const db = decodeCard(b);
    const dc: Record<Feature, number> = { shape: 0, color: 0, number: 0, shading: 0 };
    for (const k of FEATURES) dc[k] = (6 - da[k] - db[k]) % 3;
    if (!valid) {
      const k = FEATURES[Math.floor(rng() * 4)];
      const others = [0, 1, 2].filter((v) => v !== dc[k]);
      dc[k] = others[Math.floor(rng() * 2)];
    }
    const c = encodeCard(dc);
    if (c === a || c === b) continue;
    const trio: CardId[] = [a, b, c];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [trio[i], trio[j]] = [trio[j], trio[i]];
    }
    return [trio[0], trio[1], trio[2]];
  }
  return EXAMPLES[0].ids;
}
