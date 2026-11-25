/**
 * Card markup (trusted, generated from the symbol grids): one renderer for the board and every
 * static card (lobby logo, examples, rules, piles), and the even-pixel symbol width for a card
 * of a given CSS width.
 */
import { COLORS, SHADINGS, SHAPES, decodeCard } from '../lib/engine/engine.ts';
import type { CardId } from '../lib/engine/engine.ts';
import { GRID_WIDTH, snapSymbolWidth, symbolImage } from '../lib/symbols.ts';

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

/**
 * A card's inner markup: the sway, fx, lift and flip wrappers around the face and the back. The
 * board's cards and every static card use it, so they share one look; the card element around it
 * (`.card`, font-size = its width) scales the whole card. `id` null: a blank face (a back).
 */
export function cardHtml(id: CardId | null, faceUp: boolean): string {
  const face = id === null ? '' : symbolsHtml(id);
  return `<div class="w c-sway"><div class="w c-fx"><div class="w c-lift"><div class="w c-flip${faceUp ? '' : ' down'}"><div class="cface">${face}</div><div class="cback">${BACK_HTML}</div></div></div></div></div>`;
}

export function devicePixels(): number {
  return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

/** Symbol width (CSS px) for a card `cardW` px wide: whole device pixels per grid pixel. */
export function symPx(cardW: number, dpr = devicePixels()): number {
  const snapped = snapSymbolWidth(cardW * SYM_FR, dpr);
  // A tiny card (pile minis at 1×) can't fit one device pixel per grid pixel: fit it instead.
  return snapped > cardW * 0.9 ? cardW * 0.9 : snapped;
}

/**
 * A static card near `cardW` px wide, resized so its snapped symbol is exactly SYM_FR of the card,
 * the board's design proportion. Snapping a small card's symbol down to whole device pixels
 * would otherwise shrink the symbol against the card (a 50 px card at 2× drew 52 % symbols).
 * Returns the card width and its symbol width (CSS px).
 */
export function fitCard(cardW: number, dpr = devicePixels()): { readonly w: number; readonly sym: number } {
  const step = GRID_WIDTH / dpr; // one device pixel per grid pixel, in CSS px
  const k = Math.max(1, Math.round((cardW * SYM_FR) / step));
  return { w: (k * step) / SYM_FR, sym: k * step };
}
