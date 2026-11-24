/**
 * Table layout (pure). Columns are chosen once, for a 12-card board, and then kept: extra cards
 * add rows at the bottom, so every card already on the table keeps its row and column and only
 * shrinks in place. Port of the approved mockup's computeLayout().
 */

/** Card height / width. */
export const CARD_RATIO = 1.5;
/** Cards never grow past this width (px). */
export const MAX_CARD_W = 150;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Layout {
  /** Card width and height (px). */
  readonly w: number;
  readonly h: number;
  /** Columns and rows. */
  readonly c: number;
  readonly rows: number;
  /** Centre of each slot, in the same coordinates as the board rect. */
  readonly slots: readonly Point[];
  /** The board size this layout was computed for. */
  readonly bw: number;
  readonly bh: number;
  readonly top: number;
}

/** null while the board is too small to lay out (not measured yet). */
export function computeLayout(board: Rect, n: number): Layout | null {
  if (board.w < 40 || board.h < 40) return null;
  const pad = board.w < 380 ? 9 : 12;
  const W = board.w - pad * 2;
  const H = board.h - pad * 2;
  const gap = Math.round(Math.max(5, Math.min(10, W * 0.024)));
  const maxCols = W >= 620 ? 8 : 4;
  const N = Math.max(1, n);
  const fit = (count: number, cols: number) => {
    const rows = Math.ceil(count / cols);
    return Math.min((W - (cols - 1) * gap) / cols, (H - (rows - 1) * gap) / rows / CARD_RATIO);
  };
  let c = 3;
  let cw = 0;
  for (let k = 3; k <= maxCols; k++) {
    const fw = fit(12, k);
    if (fw > cw + 0.5) {
      cw = fw;
      c = k;
    }
  }
  const rows = Math.ceil(N / c);
  const w = Math.floor(Math.min(fit(N, c), MAX_CARD_W));
  const h = w * CARD_RATIO;
  const gridH = rows * h + (rows - 1) * gap;
  const gridW = c * w + (c - 1) * gap;
  const top = board.y + pad + (H - gridH) / 2;
  const left = board.x + pad + (W - gridW) / 2;
  const slots: Point[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / c);
    const col = i % c;
    slots.push({ x: left + col * (w + gap) + w / 2, y: top + row * (h + gap) + h / 2 });
  }
  return { w, h, c, rows, slots, bw: board.w, bh: board.h, top: board.y };
}
