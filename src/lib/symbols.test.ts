import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, SHADINGS, SHAPES } from './engine/engine.ts';
import { GRID_HEIGHT, GRID_WIDTH, SYMBOL_COLORS, SYMBOL_GRIDS, pixelPaths, snapSymbolWidth, symbolImage, symbolSvg } from './symbols.ts';
import type { PixelImage } from './symbols.ts';

/** Rebuild a grid of fills from the renderer's "M x y h n v1 h-n z" runs. */
function decode(image: PixelImage): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: image.height }, () => Array<string | null>(image.width).fill(null));
  for (const { fill, d } of image.paths) {
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
    assert.equal(runs.map((r) => r[0]).join(''), d, 'd is only runs');
    for (const [, x, y, w, back] of runs) {
      assert.equal(w, back);
      for (let i = Number(x); i < Number(x) + Number(w); i++) {
        assert.equal(grid[Number(y)][i], null, 'runs do not overlap');
        grid[Number(y)][i] = fill;
      }
    }
  }
  return grid;
}

describe('pixel symbols', () => {
  test('every grid is 26×13 and uses only . # o +', () => {
    assert.deepEqual([GRID_WIDTH, GRID_HEIGHT], [26, 13]);
    for (const shape of SHAPES)
      for (const shading of SHADINGS) {
        const rows = SYMBOL_GRIDS[shape][shading];
        assert.equal(rows.length, GRID_HEIGHT);
        for (const row of rows) assert.match(row, /^[.#o+]{26}$/);
      }
  });

  test('the renderer decodes back to the exact grid, for every shape and shading', () => {
    for (const shape of SHAPES)
      for (const shading of SHADINGS) {
        const rows = SYMBOL_GRIDS[shape][shading];
        const image = symbolImage(shape, shading, 'green');
        assert.equal(image.viewBox, '0 0 26 13');
        assert.equal(image.paths.length, 1, `${shape} ${shading}: bevel off → one colour, one path`);
        const expected = rows.map((row) => [...row].map((ch) => (ch === '.' ? null : SYMBOL_COLORS.green)));
        assert.deepEqual(decode(image), expected, `${shape} ${shading}`);
      }
  });

  test('with distinct colours per character (bevel on), runs split by colour and still decode exactly', () => {
    const palette = { '#': '#111111', o: '#222222', '+': '#333333' };
    for (const shape of SHAPES) {
      const rows = SYMBOL_GRIDS[shape].solid;
      const image = pixelPaths(rows, palette);
      const expected = rows.map((row) => [...row].map((ch) => (ch === '.' ? null : palette[ch as keyof typeof palette])));
      assert.deepEqual(decode(image), expected, shape);
      assert.equal(new Set(image.paths.map((p) => p.fill)).size, image.paths.length, 'one path per colour');
    }
  });

  test('svg output: crispEdges, grid viewBox, accessible title or hidden', () => {
    const hidden = symbolSvg('oval', 'open', 'purple');
    assert.match(hidden, /^<svg [^>]*viewBox="0 0 26 13" shape-rendering="crispEdges" aria-hidden="true"/);
    assert.match(hidden, /<path fill="#5b1fa6" d="M/);
    const titled = symbolSvg('diamond', 'solid', 'red', { title: 'A <red> "diamond"', className: 'x' });
    assert.match(titled, /class="x"/);
    assert.match(titled, /role="img"><title>A &lt;red> &quot;diamond&quot;<\/title>/);
    for (const color of COLORS) assert.match(symbolSvg('squiggle', 'striped', color), new RegExp(SYMBOL_COLORS[color]));
  });

  test('snapSymbolWidth: device width is a multiple of 26', () => {
    for (const dpr of [1, 1.5, 2, 2.625, 3])
      for (const css of [20, 26, 60, 75, 100, 133.3]) {
        const w = snapSymbolWidth(css, dpr);
        const device = w * dpr;
        assert.ok(Math.abs(device - Math.round(device / 26) * 26) < 1e-9, `${css}@${dpr} → ${w}`);
        assert.ok(w <= Math.max(css, 26 / dpr) + 1e-9, 'never wider than asked (unless below one device px per pixel)');
        assert.ok(device >= 26);
      }
    assert.equal(snapSymbolWidth(80, 1), 78);
    assert.equal(snapSymbolWidth(80, 2), 78);
    assert.equal(snapSymbolWidth(80, 3), 234 / 3);
    assert.equal(snapSymbolWidth(10, 1), 26, 'at least one device pixel per grid pixel');
  });
});
