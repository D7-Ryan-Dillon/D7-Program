// The exact outline used around every tile module on a board, measured
// directly from the reference boards' own vector paths (the user supplied
// the original PDF; these fractions were extracted by parsing its content
// stream's path operators, not eyeballed from a raster). A square module,
// normalized to its own side length (0..1 in both axes), traced as one
// continuous closed path:
//
//  - every corner is a plain right angle EXCEPT the top-left, which has a
//    small rectangular tab bumped OUT (up and left) rather than a corner
//    cut IN -- connected to the main square by two short diagonal chamfers.
//  - the right edge runs straight down past the square's own bottom-right
//    corner into a small pentagon "name tag" that hangs below the portion
//    of the square from DIVIDER_X to the right edge, with a single
//    diagonal on the tag's own left side closing back up to the square's
//    bottom edge.
//  - on the descriptor page only, a plain vertical divider at DIVIDER_X
//    splits the square into an image portion (left) and a descriptor
//    column (right) -- DIVIDER_X is exactly the tag's own left edge, so
//    the tag reads as a continuation of that column.

export type Point = [number, number];

/** X where the descriptor-page divider sits, and where the name tag's own
 * left edge begins -- both the same fraction, by construction. */
export const DIVIDER_X = 0.6864;

/** How far below the square's own bottom edge the name tag extends,
 * as a fraction of the square's side length. */
export const TAG_HEIGHT_FRACTION = 0.0716;

/** How far down the square's main top edge sits, as a fraction of the
 * square's side length -- the top-left tab pokes up above this level, so
 * anything drawn flush with the square's top (like the descriptor-page
 * divider) needs to start here, not at y=0, or it overshoots past the
 * frame outline. */
export const TOP_EDGE_FRACTION = 0.0279;

/** The full module outline (square + top-left tab + bottom-right name
 * tag), in natural clockwise drawing order starting at the square's own
 * bottom-left corner, as fractions of the square's side length. */
export const MODULE_OUTLINE: Point[] = [
  [0.0152, 1.0], // square's bottom-left
  [0.0152, 0.196], // up the left edge to the tab's neck
  [0.0, 0.1645], // chamfer out to the tab's own left edge
  [0.0, 0.0], // up to the tab's apex (top-left-most point)
  [0.151, 0.0], // right along the tab's top
  [0.168, 0.0279], // chamfer back down to the square's main top level
  [1.0, 0.0279], // right along the square's top edge
  [1.0, 1.0 + TAG_HEIGHT_FRACTION], // straight down the right edge, past the square's own bottom-right, to the tag's bottom-right
  [DIVIDER_X + 0.0447, 1.0 + TAG_HEIGHT_FRACTION], // left along the tag's bottom
  [DIVIDER_X, 1.0], // diagonal up to the square's bottom edge (the tag's own left chamfer)
  // closes back to [0.0152, 1.0]
];

/** The name tag's own geometry, as fractions of the module's side: where its
 * left edge starts (x) and how far it hangs below the square. */
export interface TagGeometry {
  startX: number;
  height: number;
}
export const DEFAULT_TAG: TagGeometry = { startX: DIVIDER_X, height: TAG_HEIGHT_FRACTION };

/** The module outline with a custom name tag -- the tag's slanted left side
 * keeps the same proportion to its height as the original. */
export function moduleOutline(tag: TagGeometry = DEFAULT_TAG): Point[] {
  const bevel = tag.height * (0.0447 / TAG_HEIGHT_FRACTION);
  return [...MODULE_OUTLINE.slice(0, 7), [1.0, 1.0 + tag.height], [tag.startX + bevel, 1.0 + tag.height], [tag.startX, 1.0]];
}

export function scalePoints(points: Point[], size: number): Point[] {
  return points.map(([x, y]) => [x * size, y * size]);
}

export function traceModuleOutline(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tag: TagGeometry = DEFAULT_TAG) {
  const points = scalePoints(moduleOutline(tag), size);
  ctx.beginPath();
  ctx.moveTo(x + points[0][0], y + points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(x + px, y + py);
  ctx.closePath();
}

/** Just the square + its top-left tab, stopping at the square's own
 * bottom-right corner -- the name tag isn't part of this path at all. Used
 * to clip the tile render / descriptor list so they never bleed into the
 * tag below. */
export const SQUARE_OUTLINE: Point[] = [...MODULE_OUTLINE.slice(0, 7), [1.0, 1.0]];

export function traceSquareOnly(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const points = scalePoints(SQUARE_OUTLINE, size);
  ctx.beginPath();
  ctx.moveTo(x + points[0][0], y + points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(x + px, y + py);
  ctx.closePath();
}
