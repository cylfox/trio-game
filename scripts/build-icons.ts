/**
 * Builds the app icons into public/ (dev-only; the outputs are committed, so CI never runs this).
 *   npm run icons
 *
 * Design ("Pixel 3"), on a 512×512 canvas:
 *   background  radial gradient #33276f (cx 50%, cy 30%, r 80%) → #110d24
 *   "3"         Jersey 10, size 430, centred on x 256, baseline 350, gold #ffc23d, with a hard
 *               shadow: the same glyph in #0c0917 at baseline 372
 *   squares     56×56 at y 398, x 150 / 228 / 306, in the card red, green and purple
 * The glyph is converted to a path from the Fontsource WOFF, so icon.svg needs no font.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parse } from 'opentype.js/dist/opentype.mjs';

const root = new URL('../', import.meta.url);
const out = (name: string) => new URL(`public/${name}`, root);

const fontBytes = readFileSync(new URL('node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff', root));
const font = parse(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer);

const SIZE = 430;
const advance = font.getAdvanceWidth('3', SIZE);
/** text-anchor="middle": centre the advance width on x = 256. */
const glyph = (baseline: number) => font.getPath('3', 256 - advance / 2, baseline, SIZE);
const gold = glyph(350);
const shadow = glyph(372);

const SQUARES = [
  { x: 150, fill: '#d4152f' },
  { x: 228, fill: '#0fa154' },
  { x: 306, fill: '#5b1fa6' },
];

const art = [
  `<path d="${shadow.toPathData(2)}" fill="#0c0917"/>`,
  `<path d="${gold.toPathData(2)}" fill="#ffc23d"/>`,
  ...SQUARES.map((s) => `<rect x="${s.x}" y="398" width="56" height="56" fill="${s.fill}"/>`),
].join('\n  ');

// Maskable icons: everything that matters must sit inside the centred circle of radius 0.4 × size.
const box = shadow.getBoundingBox();
const top = Math.min(gold.getBoundingBox().y1, box.y1);
const corners: Array<[number, number]> = [
  [Math.min(box.x1, 150), top],
  [Math.max(box.x2, 362), top],
  [Math.min(box.x1, 150), 454],
  [Math.max(box.x2, 362), 454],
];
const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x - 256, y - 256)));
const SAFE = 0.4 * 512 - 4;
const maskScale = Math.min(0.8, SAFE / reach);

function svg(maskable: boolean): string {
  const body = maskable ? `<g transform="translate(256 256) scale(${maskScale.toFixed(4)}) translate(-256 -256)">\n  ${art}\n  </g>` : art;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><radialGradient id="bg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#33276f"/><stop offset="1" stop-color="#110d24"/></radialGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${body}
</svg>
`;
}

function png(source: string, size: number, name: string): void {
  const image = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render();
  writeFileSync(out(name), image.asPng());
  console.log(`${name.padEnd(24)} ${image.width}×${image.height}`);
}

const plain = svg(false);
const maskable = svg(true);
writeFileSync(out('icon.svg'), plain);
console.log(`icon.svg                 glyph bbox y ${top.toFixed(1)}..${box.y2.toFixed(1)}, maskable scale ${maskScale.toFixed(3)}`);
png(plain, 32, 'favicon.png');
png(plain, 180, 'apple-touch-icon.png');
png(plain, 192, 'icon-192.png');
png(plain, 512, 'icon-512.png');
png(maskable, 512, 'icon-maskable-512.png');
