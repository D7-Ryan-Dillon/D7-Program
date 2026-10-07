// Shrink-to-fit text sizing shared by the title, caption, tile name tags,
// and descriptor list -- each can be pinned to a manual size instead
// (BoardConfig's titleFontSizePt/captionFontSizePt, BoardSlot's
// nameFontSizePt), in which case none of this runs.

export function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const next = `${line} ${word}`;
    if (ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
}

/** Finds the largest font size (down to minSize) at which `text` -- wrapped
 * to at most maxLines -- fits within maxWidth x maxHeight. Tries one line
 * first, then progressively more lines, shrinking as needed; always
 * returns *something* (clamped to minSize) rather than failing. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  { maxFontSize = 200, minFontSize = 6, maxLines = 2, fontWeight = "", fontFamily }: { maxFontSize?: number; minFontSize?: number; maxLines?: number; fontWeight?: string; fontFamily: string },
): FitResult {
  for (let size = maxFontSize; size >= minFontSize; size -= 1) {
    ctx.font = `${fontWeight ? fontWeight + " " : ""}${size}px "${fontFamily}"`;
    const oneLine = ctx.measureText(text).width <= maxWidth;
    const lineHeight = size * 1.2;
    if (oneLine && lineHeight <= maxHeight) {
      return { fontSize: size, lines: [text] };
    }
    if (maxLines > 1) {
      const wrapped = wrapToWidth(ctx, text, maxWidth);
      // every wrapped line must fit too: a single long word (CONTINUOUS, NON-HIERARCHICAL) cannot be wrapped and used to overflow
      const fits = wrapped.length <= maxLines && wrapped.length * lineHeight <= maxHeight && wrapped.every((l) => ctx.measureText(l).width <= maxWidth);
      if (fits) return { fontSize: size, lines: wrapped };
    }
  }
  ctx.font = `${fontWeight ? fontWeight + " " : ""}${minFontSize}px "${fontFamily}"`;
  const wrapped = maxLines > 1 ? wrapToWidth(ctx, text, maxWidth).slice(0, maxLines) : [text];
  return { fontSize: minFontSize, lines: wrapped };
}

/** Wraps `text` to a width, keeping the line breaks you typed: each line of the text is wrapped on its own, and an empty line stays as a gap. */
export function wrapParagraphs(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").flatMap((para) => (para.trim() ? wrapToWidth(ctx, para, maxWidth) : [""]));
}

/** The largest font size (down to minFontSize) at which `text`, with its own line breaks, wrapped to maxWidth, fits in maxHeight at `lineSpacing` times the size per line. */
export function fitParagraphs(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  { maxFontSize, minFontSize = 6, lineSpacing = 1.3, fontFamily }: { maxFontSize: number; minFontSize?: number; lineSpacing?: number; fontFamily: string },
): FitResult {
  let lines: string[] = [];
  for (let size = Math.floor(maxFontSize); size >= minFontSize; size -= 1) {
    ctx.font = `${size}px "${fontFamily}"`;
    lines = wrapParagraphs(ctx, text, maxWidth);
    if (lines.length * size * lineSpacing <= maxHeight && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { fontSize: size, lines };
  }
  ctx.font = `${minFontSize}px "${fontFamily}"`;
  return { fontSize: minFontSize, lines: wrapParagraphs(ctx, text, maxWidth) };
}
