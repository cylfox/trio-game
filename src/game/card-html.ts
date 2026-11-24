/**
 * Card face and back markup (trusted, generated from the symbol grids), and the even-pixel
 * symbol width for a card of a given CSS width.
 */
import { COLORS, SHADINGS, SHAPES, decodeCard } from '../lib/engine/engine.ts';
import type { CardId } from '../lib/engine/engine.ts';
import { snapSymbolWidth, symbolImage } from '../lib/symbols.ts';

/** Largest symbol width as a fraction of the card width; the even-pixel snap only rounds down. */
export const SYM_FR = 0.74;

const cache = new Map<CardId, string>();

/** The card's symbols (count × the same SVG), no wrapper. */
export function symbolsHtml(id: CardId): string {
  let html = cache.get(id);
  if (html === undefined) {
    const f = decodeCard(id);
    const image = symbolImage(SHAPES[f.shape], SHADINGS[f.shading], COLORS[f.color]);
    const paths = image.paths.map((p) => `<path fill="${p.fill}" d="${p.d}"/>`).join('');
    const svg = `<svg class="sym" viewBox="${image.viewBox}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${paths}</svg>`;
    html = svg.repeat(f.number + 1);
    cache.set(id, html);
  }
  return html;
}

export const BACK_HTML =
  '<div class="back-plaque"><span class="back-word">Trio</span><span class="back-dots"><i></i><i></i><i></i></span></div>';

export function devicePixels(): number {
  return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

/** Symbol width (CSS px) for a card `cardW` px wide: whole device pixels per grid pixel. */
export function symPx(cardW: number, dpr = devicePixels()): number {
  const snapped = snapSymbolWidth(cardW * SYM_FR, dpr);
  // A tiny card (pile minis at 1×) can't fit one device pixel per grid pixel: fit it instead.
  return snapped > cardW * 0.9 ? cardW * 0.9 : snapped;
}
