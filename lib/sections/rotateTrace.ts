// Rotates a 2D section trace by quarter turns (clockwise, as drawn) before it
// is lofted -- so a face can be given any of its tile's four orientations
// without touching the lofting code. A trace is SVG path data in a
// width x height box; a quarter turn maps (x, y) -> (height - y, x) and swaps
// the box's width and height. Paths are rewritten with absolute coordinates.

import type { SectionTrace } from "./volumeField";

type Seg = { cmd: string; args: number[] };

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function parse(d: string): Seg[] {
  const segs: Seg[] = [];
  let cmd = "";
  let nums: number[] = [];
  const flush = () => {
    if (!cmd) return;
    const n = ARITY[cmd.toUpperCase()];
    if (n === 0) {
      segs.push({ cmd, args: [] });
    } else {
      for (let i = 0; i + n <= nums.length; i += n) {
        // After the first pair, extra pairs of M/m are implicit L/l.
        const c = i > 0 && (cmd === "M" || cmd === "m") ? (cmd === "M" ? "L" : "l") : cmd;
        segs.push({ cmd: c, args: nums.slice(i, i + n) });
      }
    }
    nums = [];
  };
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else nums.push(parseFloat(m[2]));
  }
  flush();
  return segs;
}

/** One clockwise quarter turn of a path inside a box of height `h`. */
function quarterTurn(d: string, h: number): string {
  const segs = parse(d);
  const out: string[] = [];
  const rot = (x: number, y: number): [number, number] => [h - y, x];
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC: [number, number] | null = null; // last cubic control point (absolute, pre-rotation)
  let lastQ: [number, number] | null = null;

  for (const { cmd, args } of segs) {
    const rel = cmd === cmd.toLowerCase() && cmd.toUpperCase() !== "Z";
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    let nextC: [number, number] | null = null;
    let nextQ: [number, number] | null = null;
    switch (C) {
      case "M": {
        const [x, y] = [args[0] + ox, args[1] + oy];
        out.push(`M${rot(x, y).map(fmt).join(" ")}`);
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "L": {
        const [x, y] = [args[0] + ox, args[1] + oy];
        out.push(`L${rot(x, y).map(fmt).join(" ")}`);
        cx = x;
        cy = y;
        break;
      }
      case "H": {
        const x = args[0] + ox;
        out.push(`L${rot(x, cy).map(fmt).join(" ")}`);
        cx = x;
        break;
      }
      case "V": {
        const y = args[0] + oy;
        out.push(`L${rot(cx, y).map(fmt).join(" ")}`);
        cy = y;
        break;
      }
      case "C":
      case "S": {
        let x1: number, y1: number;
        let k = 0;
        if (C === "C") {
          x1 = args[0] + ox;
          y1 = args[1] + oy;
          k = 2;
        } else {
          [x1, y1] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
        }
        const [x2, y2, x, y] = [args[k] + ox, args[k + 1] + oy, args[k + 2] + ox, args[k + 3] + oy];
        out.push(`C${[...rot(x1, y1), ...rot(x2, y2), ...rot(x, y)].map(fmt).join(" ")}`);
        nextC = [x2, y2];
        cx = x;
        cy = y;
        break;
      }
      case "Q":
      case "T": {
        let x1: number, y1: number;
        let k = 0;
        if (C === "Q") {
          x1 = args[0] + ox;
          y1 = args[1] + oy;
          k = 2;
        } else {
          [x1, y1] = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
        }
        const [x, y] = [args[k] + ox, args[k + 1] + oy];
        out.push(`Q${[...rot(x1, y1), ...rot(x, y)].map(fmt).join(" ")}`);
        nextQ = [x1, y1];
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        const [rx, ry, phi, large, sweep] = args;
        const [x, y] = [args[5] + ox, args[6] + oy];
        // A quarter turn swaps the radii and adds 90 degrees; flags are unchanged (no reflection).
        out.push(`A${fmt(ry)} ${fmt(rx)} ${fmt(phi + 90)} ${large} ${sweep} ${rot(x, y).map(fmt).join(" ")}`);
        cx = x;
        cy = y;
        break;
      }
      case "Z":
        out.push("Z");
        cx = sx;
        cy = sy;
        break;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return out.join(" ");
}

/** `turns` clockwise quarter turns (0-3) of a trace; a fresh object, input untouched. */
export function rotateTrace(trace: SectionTrace, turns: number): SectionTrace {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  let cur = trace;
  for (let i = 0; i < t; i++) {
    cur = { width: cur.height, height: cur.width, shapes: cur.shapes.map((s) => ({ ...s, d: quarterTurn(s.d, cur.height) })) };
  }
  return cur;
}

/** A face mask (size x size, row-major) turned `turns` clockwise quarter turns. */
export function rotateMask(mask: Uint8Array, size: number, turns: number): Uint8Array {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  let cur = mask;
  for (let k = 0; k < t; k++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) next[y * size + x] = cur[(size - 1 - x) * size + y];
    cur = next;
  }
  return cur;
}
