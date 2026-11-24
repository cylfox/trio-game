// Minimal types for the parts of opentype.js 2.x that scripts/build-icons.ts uses (it ships none).
declare module 'opentype.js/dist/opentype.mjs' {
  export interface BoundingBox {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }
  export interface Path {
    toPathData(decimals?: number): string;
    getBoundingBox(): BoundingBox;
  }
  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path;
    getAdvanceWidth(text: string, fontSize: number): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
