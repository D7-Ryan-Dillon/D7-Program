// The frame around each tile (and the title block) in the reference boards:
// a rectangle with its top-right corner cut off at a diagonal. One shared
// definition so the live CSS preview and the canvas export draw the exact
// same shape.

export function cutCornerPoints(width: number, height: number, chamfer: number): [number, number][] {
  const c = Math.max(0, Math.min(chamfer, Math.min(width, height) * 0.6));
  return [
    [0, 0],
    [width - c, 0],
    [width, c],
    [width, height],
    [0, height],
  ];
}

export function cutCornerClipPath(width: number, height: number, chamfer: number): string {
  const points = cutCornerPoints(width, height, chamfer);
  return `polygon(${points.map(([x, y]) => `${(x / width) * 100}% ${(y / height) * 100}%`).join(", ")})`;
}

/** A CSS-only cut-corner clip-path that works at any element size without
 * knowing its actual rendered pixel dimensions: both axes are cut by the
 * same *percentage*, so (unlike cutCornerClipPath, which bakes in one
 * width/height ratio) it doesn't distort when the real element isn't
 * square. Used for live on-screen previews; the canvas export path always
 * knows real pixel sizes and uses traceCutCorner directly instead. */
export function cutCornerClipPathPercent(chamferPercent = 14): string {
  const c = chamferPercent;
  return `polygon(0 0, ${100 - c}% 0, 100% ${c}%, 100% 100%, 0 100%)`;
}

export function traceCutCorner(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, chamfer: number) {
  const points = cutCornerPoints(width, height, chamfer).map(([px, py]) => [x + px, y + py] as const);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
}

/** A reasonable chamfer size for a frame of this width -- scales with the
 * frame, same proportion the reference boards use. */
export function chamferFor(width: number, height: number): number {
  return Math.min(width, height) * 0.14;
}
