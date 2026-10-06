// A tiny software renderer so arrangements can be LOOKED AT without a browser: an isometric view of the material (each piece in its
// own colour, lit by face direction) beside a plan slice through the rooms (solid = piece colour, carved space = white, outside any
// container = black, doorways show as gaps in the walls). Writes a PNG with node's zlib only.

import { crc32, deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildComposite } from "../../lib/arrange/composite";
import type { PlacedBox } from "../../lib/arrange/geometry";

const PALETTE: [number, number, number][] = [
  [232, 166, 200], // soft pink
  [219, 114, 40], // orange
  [196, 51, 131], // magenta
  [242, 184, 120], // peach
  [150, 150, 150],
  [200, 200, 200],
  [120, 170, 190],
  [170, 200, 120],
];

class Img {
  data: Uint8Array;
  constructor(public w: number, public h: number, bg: [number, number, number] = [18, 18, 18]) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 3);
  }
  set(x: number, y: number, c: [number, number, number]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set(c, (y * this.w + x) * 3);
  }
  rect(x: number, y: number, w: number, h: number, c: [number, number, number]) {
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) this.set(x + a, y + b, c);
  }
}

function png(img: Img): Buffer {
  const raw = Buffer.alloc((img.w * 3 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 3 + 1)] = 0;
    Buffer.from(img.data.buffer, y * img.w * 3, img.w * 3).copy(raw, y * (img.w * 3 + 1) + 1);
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const shade = (c: [number, number, number], k: number): [number, number, number] => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/** Writes `file` (a .png): iso view on the left, plan slices at one or two heights on the right. */
export function renderArrangement(boxes: PlacedBox[], file: string, opts: { cell?: number; sliceZ?: number[] } = {}) {
  const comp = buildComposite(boxes);
  if (!comp) return;
  const [nx, ny, nz] = comp.grid;
  const c = opts.cell ?? Math.max(2, Math.min(5, Math.floor(700 / (nx + ny))));
  const idx = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  const solidAt = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && comp.mask[idx(x, y, z)] === 1 && comp.void[idx(x, y, z)] === 0;
  // iso view
  const isoW = (nx + ny) * c + 20;
  const isoH = (nx + ny) * (c / 2) + nz * c + 20;
  const planW = nx * c + 20;
  const slices = opts.sliceZ ?? [Math.min(nz - 1, 8)];
  const W = isoW + (planW + 10) * slices.length;
  const H = Math.max(isoH, ny * c + 20);
  const img = new Img(W, H);
  const ox = ny * c + 10;
  const oy = nz * c + 10;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        if (!solidAt(x, y, z)) continue;
        const top = !solidAt(x, y, z + 1);
        const east = !solidAt(x + 1, y, z);
        const south = !solidAt(x, y + 1, z);
        if (!top && !east && !south) continue;
        const col = PALETTE[Math.max(0, comp.owner[idx(x, y, z)]) % PALETTE.length];
        const k = top ? 1 : east ? 0.78 : 0.6;
        const px = ox + (x - y) * c;
        const py = oy + (x + y) * (c / 2) - z * c;
        img.rect(px, py, c, c, shade(col, k));
      }
  // plan slices
  slices.forEach((sz, s) => {
    const x0 = isoW + s * (planW + 10) + 10;
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const i = idx(x, y, sz);
        const color: [number, number, number] = !comp.mask[i] ? [0, 0, 0] : comp.void[i] ? [235, 235, 235] : shade(PALETTE[Math.max(0, comp.owner[i]) % PALETTE.length], 0.85);
        img.rect(x0 + x * c, 10 + (ny - 1 - y) * c, c, c, color);
      }
  });
  writeFileSync(file, png(img));
}
