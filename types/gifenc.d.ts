// gifenc ships no typings; this covers just the parts lib/boards/gifExport.ts uses.
declare module "gifenc" {
  export type Palette = number[][];

  export interface QuantizeOptions {
    format?: "rgb565" | "rgb444" | "rgba4444";
  }

  export interface FrameOptions {
    palette?: Palette;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** -1=once, 0=forever, >0=count. Honoured on the first frame. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void;
    finish(): void;
    bytesView(): Uint8Array<ArrayBuffer>;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: QuantizeOptions): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
