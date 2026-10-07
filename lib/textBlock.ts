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
