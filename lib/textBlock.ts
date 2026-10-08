// Text that always fits where it is supposed to: it wraps at word breaks (and inside a word that is longer than the box), shrinks down
// to a minimum size, and only then cuts with an ellipsis. Never squeezes the letters (canvas fillText with a max width does that, and
// it reads as squished). Used by every canvas export that prints text into a box.

export const BOARD_FONT = '"Arkitech", "Orbitron", system-ui, sans-serif';

export interface BlockOptions {
  max: number;
  min?: number;
  maxLines?: number;
  weight?: string;
  family?: string;
  /** line height as a multiple of the size */
  lineHeight?: number;
}

export interface Block {
  size: number;
  lines: string[];
  lineHeight: number;
  /** total height of the text, px */
  height: number;
}

const fontOf = (size: number, o: BlockOptions) => `${o.weight ? o.weight + " " : ""}${size}px ${o.family ?? BOARD_FONT}`;

/** Wraps at spaces; a single word wider than the box is broken between letters. */
function wrap(ctx: CanvasRenderingContext2D, text: string, w: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= w) {
      line = next;
      continue;
    }
    push();
    if (ctx.measureText(word).width <= w) {
      line = word;
      continue;
    }
    // a word longer than the box: break it between letters
    let piece = "";
    for (const ch of word) {
      if (ctx.measureText(piece + ch).width > w && piece) {
        lines.push(piece);
        piece = ch;
      } else piece += ch;
    }
    line = piece;
  }
  push();
  return lines;
}

/** The largest size (down to \`min\`) at which \`text\` fits a w x h box in at most \`maxLines\` lines. */
export function fitBlock(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, o: BlockOptions): Block {
  const min = o.min ?? 8;
  const maxLines = o.maxLines ?? 1;
  const lh = o.lineHeight ?? 1.22;
  let last: Block | null = null;
  const words = text.split(/s+/).filter(Boolean);
  for (let size = o.max; size >= min; size -= 1) {
    ctx.font = fontOf(size, o);
    // a word is never split across two lines while a smaller size would keep it whole: the size comes down until the longest word fits the width
    if (size > min && words.some((word) => ctx.measureText(word).width > w)) continue;
    const lines = wrap(ctx, text, w);
    last = { size, lines, lineHeight: size * lh, height: lines.length * size * lh };
    if (lines.length <= maxLines && last.height <= h) return last;
  }
  // nothing fits at the smallest size: keep what fits and end the last line with an ellipsis
  const size = min;
  ctx.font = fontOf(size, o);
  const all = wrap(ctx, text, w);
  // only as many lines as the box is tall (at least one), so the text never runs into what is below it
  const room = Math.max(1, Math.min(maxLines, Math.floor(h / (size * lh))));
  const lines = all.slice(0, room);
  const lastLine = lines[lines.length - 1] ?? "";
  let cut = lastLine;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > w) cut = cut.slice(0, -1);
  if (cut !== lastLine || all.length > room) lines[lines.length - 1] = cut + "…";
  return { size, lines, lineHeight: size * lh, height: lines.length * size * lh };
}

/** Draws \`text\` fitted into the box (x, y is its top-left, or top-right / top-centre by \`align\`); returns the height used. */
export function drawBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, o: BlockOptions & { color: string; align?: CanvasTextAlign }): number {
  const b = fitBlock(ctx, text, w, h, o);
  ctx.font = fontOf(b.size, o);
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  const ax = o.align === "right" ? x + w : o.align === "center" ? x + w / 2 : x;
  b.lines.forEach((l, i) => ctx.fillText(l, ax, y + b.size * 0.95 + i * b.lineHeight));
  return b.height;
}

// ---- sentences that are shortened, not cut ------------------------------------------------------------------------------------------------------------------

/** The text as it is, then shorter and shorter wordings that keep what it says first: without the parentheses, the first sentence, the first clause, the first few words. */
export function shortenings(text: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const s = raw.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim().replace(/[;,:]$/, "");
    if (s && !out.includes(s)) out.push(s);
  };
  add(text);
  const plain = text.replace(/\s*\([^)]*\)/g, "");
  add(plain);
  const first = plain.split(/(?<=[.!?])\s+/)[0] ?? plain;
  add(first);
  const clause = first.split(/;|, (?:besides|from|so|and|with|which)\b| - | \u2014 /)[0] ?? first;
  add(clause);
  const words = clause.split(" ");
  for (const n of [9, 7, 6, 5, 4, 3]) if (words.length > n) add(words.slice(0, n).join(" "));
  return out;
}

/** The block at the largest size from `o.max` down to `comfort` at which the text fits whole (no word split, no cut line), or null. */
function fitAbove(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, o: BlockOptions, comfort: number): Block | null {
  const maxLines = o.maxLines ?? 1;
  const lh = o.lineHeight ?? 1.22;
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = o.max; size >= comfort; size -= 1) {
    ctx.font = fontOf(size, o);
    if (words.some((word) => ctx.measureText(word).width > w)) continue;
    const lines = wrap(ctx, text, w);
    if (lines.length <= maxLines && lines.length * size * lh <= h) return { size, lines, lineHeight: size * lh, height: lines.length * size * lh };
  }
  return null;
}

/**
 * Draws `text` in a box so that it reads whole: the wording is shortened (see `shortenings`) until it fits at a size of at least `comfort`; only when no wording fits does it
 * shrink further and end with an ellipsis. Returns the height used.
 */
export function drawShortened(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, o: BlockOptions & { color: string; align?: CanvasTextAlign; comfort: number }): number {
  let block: Block | null = null;
  for (const s of shortenings(text)) {
    block = fitAbove(ctx, s, w, h, o, o.comfort);
    if (block) return drawBlock(ctx, s, x, y, w, h, { ...o, max: block.size, min: block.size });
  }
  return drawBlock(ctx, shortenings(text).slice(-1)[0] ?? text, x, y, w, h, o);
}
