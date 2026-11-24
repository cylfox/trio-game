/**
 * Pixel-art card symbols: typed port of pixel-symbols.js.
 *
 * Each symbol is a GRID_WIDTH × GRID_HEIGHT grid (26×13, the same 2:1 as a card symbol slot).
 * The renderer merges horizontal runs of one colour into "M x y h n v1 h-n z" rectangles, one
 * <path> per fill colour, in a viewBox of grid units with shape-rendering="crispEdges". Size the
 * <svg> with CSS; use snapSymbolWidth() so each grid pixel lands on whole device pixels.
 *
 * The bevel is off: rim ('o') and highlight ('+') pixels take the symbol colour, so every symbol
 * is a single path.
 */
import type { Color, Shading, Shape } from './engine/engine.ts';
import { GRID_HEIGHT, GRID_WIDTH, SYMBOL_COLORS, SYMBOL_GRIDS } from './symbol-data.ts';

export { GRID_HEIGHT, GRID_WIDTH, SYMBOL_COLORS, SYMBOL_GRIDS } from './symbol-data.ts';

/** grid character → fill. '#' is required; other characters fall back to palette['#']. */
export type Palette = Readonly<Record<string, string>> & { readonly '#': string };

export interface PixelPath {
  readonly fill: string;
  readonly d: string;
}

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  /** "0 0 W H" in grid units. */
  readonly viewBox: string;
  /** One path per fill colour, in order of first appearance (top-left first). */
  readonly paths: readonly PixelPath[];
}

/** Rows of equal length; '.' is empty, any other character is a pixel coloured by `palette`. */
export function pixelPaths(rows: readonly string[], palette: Palette): PixelImage {
  const height = rows.length;
  const width = height === 0 ? 0 : rows[0].length;
  const layers = new Map<string, string>();
  const fillOf = (ch: string) => palette[ch] ?? palette['#'];
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    let x = 0;
    while (x < width) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      const fill = fillOf(ch);
      const start = x;
      while (x < width && row[x] !== '.' && fillOf(row[x]) === fill) x++;
      const run = x - start;
      layers.set(fill, `${layers.get(fill) ?? ''}M${start} ${y}h${run}v1h-${run}z`);
    }
  }
  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    paths: [...layers].map(([fill, d]) => ({ fill, d })),
  };
}

/** The palette with the bevel off: everything in the symbol colour. */
export function symbolPalette(color: Color): Palette {
  return { '#': SYMBOL_COLORS[color] };
}

const cache = new Map<string, PixelImage>();

/** A card symbol's paths (cached). */
export function symbolImage(shape: Shape, shading: Shading, color: Color): PixelImage {
  const key = `${shape}/${shading}/${color}`;
  let image = cache.get(key);
  if (image === undefined) {
    image = pixelPaths(SYMBOL_GRIDS[shape][shading], symbolPalette(color));
    cache.set(key, image);
  }
  return image;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** The symbol as a standalone SVG string (no title → aria-hidden). */
export function symbolSvg(shape: Shape, shading: Shading, color: Color, options: { className?: string; title?: string } = {}): string {
  const image = symbolImage(shape, shading, color);
  const a11y = options.title === undefined ? ' aria-hidden="true" focusable="false">' : ` role="img"><title>${escapeXml(options.title)}</title>`;
  const paths = image.paths.map((p) => `<path fill="${escapeXml(p.fill)}" d="${p.d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeXml(options.className ?? 'sym')}" viewBox="${image.viewBox}" shape-rendering="crispEdges"${a11y}${paths}</svg>`;
}

/**
 * The largest CSS width ≤ `cssWidth` at which every grid pixel is a whole number of device
 * pixels (device width a multiple of GRID_WIDTH), and never below one device pixel per grid pixel.
 * Pixels are only even at these widths.
 */
export function snapSymbolWidth(cssWidth: number, dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const scale = Math.max(1, Math.floor((cssWidth * ratio) / GRID_WIDTH));
  return (scale * GRID_WIDTH) / ratio;
}

/** Height that matches a snapped width (keeps the grid's aspect ratio exactly). */
export function symbolHeightFor(width: number): number {
  return (width * GRID_HEIGHT) / GRID_WIDTH;
}
