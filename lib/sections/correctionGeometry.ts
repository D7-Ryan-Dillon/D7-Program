// Ported from Section-Field's research/correction-editor/geometry.js and
// cleanup.js -- Paper.js is used here purely as a headless geometry engine
// (compound-path boolean ops, point-in-path tests, path data), never for
// its own canvas rendering; the editor component does its own SVG
// rendering, same as the original.

// paper's default package entry (dist/paper-full.js) branches into a
// Node/jsdom compatibility shim when no `document` is present -- which is
// exactly what Next.js's server-side render pass of this ("use client")
// code looks like, even though it only ever actually runs in the browser.
// Next's SSR trace doesn't apply package.json's "browser" field (that's a
// browser-bundler convention, not a Node one), so the plain "paper" import
// drags in that Node branch and fails on a jsdom internal we don't have
// and don't want -- importing the lighter paper-core build directly (no
// Node branch at all, the same build Section-Field's own prototype used)
// sidesteps it entirely.
import paperCore from "paper/dist/paper-core.js";
import type PaperScope from "paper";
const paper = paperCore as unknown as typeof PaperScope;
export { paper };

let setupDone = false;
/** Paper.js needs a canvas-sized "view" to exist before any geometry calls
 * work, even in headless/no-render use -- this sets that up once, lazily,
 * so importing this module has no side effect until the editor actually
 * mounts (avoids touching `document` during SSR). */
export function ensurePaperSetup() {
  if (setupDone) return;
  paper.setup(new paper.Size(800, 800));
  setupDone = true;
}

export interface Shape {
  d: string;
}

const asPaths = (item: paper.CompoundPath | paper.Path): paper.Path[] => (item as paper.CompoundPath).children ? ((item as paper.CompoundPath).children as unknown as paper.Path[]) : [item as paper.Path];

/** Parses one shape's `d` into a live Paper.js compound path -- evenodd,
 * reoriented so outer contours wind one way and holes the other (Paper's
 * own boolean ops rely on consistent winding, not evenodd, to tell them
 * apart). `insert: false` keeps it out of Paper's own scene graph, since
 * this app never renders through Paper.js. */
export function makePath(d: string): paper.CompoundPath {
  const p = new paper.CompoundPath({ pathData: d, insert: false });
  p.fillRule = "evenodd";
  p.reorient(false, true);
  return p;
}

export function pathsOf(item: paper.CompoundPath | paper.Path): paper.Path[] {
  return asPaths(item);
}

/** Splits a (possibly multi-contour) path back into one Shape per outer
 * contour, each keeping its own holes -- nested islands stay separate
 * objects rather than collapsing into one shape with unrelated holes. */
export function splitShapes(item: paper.CompoundPath | paper.Path): Shape[] {
  const all = asPaths(item);
  const outer = all.filter((p) => p.clockwise);
  const buckets: paper.Path[][] = outer.map((p) => [p]);
  for (const hole of all.filter((p) => !p.clockwise)) {
    const candidates = outer
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.bounds.contains(hole.bounds) && p.contains(hole.interiorPoint))
      .sort((a, b) => Math.abs(a.p.area) - Math.abs(b.p.area));
    if (candidates.length) buckets[candidates[0].i].push(hole);
  }
  return buckets.map((parts) => ({ d: parts.map((p) => p.pathData).join(" ") }));
}

export interface CleanupOptions {
  fragmentArea?: number;
  holeArea?: number;
  protectedIndices?: number[];
}

export interface CleanupResult {
  shapes: Shape[];
  removed: string[];
  filled: string[];
}

/** Drops mass fragments smaller than `fragmentArea` and fills holes smaller
 * than `holeArea` (both in d-space square units) -- a one-shot tidy-up
 * pass, previewed before the user applies it. A hole that contains another
 * object (an island inside it) is never filled, protected or not. */
export function cleanupShapes(shapes: Shape[], { fragmentArea = 0, holeArea = 0, protectedIndices = [] }: CleanupOptions = {}): CleanupResult {
  const protectedSet = new Set(protectedIndices);
  const removed: string[] = [];
  const filled: string[] = [];
  const result: Shape[] = [];
  shapes.forEach((shape, index) => {
    if (protectedSet.has(index)) {
      result.push({ ...shape });
      return;
    }
    for (const component of splitShapes(makePath(shape.d))) {
      const item = makePath(component.d);
      if (fragmentArea > 0 && Math.abs(item.area) < fragmentArea) {
        removed.push(component.d);
        continue;
      }
      const retained = pathsOf(item).filter((path) => {
        if (!path.clockwise && holeArea > 0 && Math.abs(path.area) < holeArea) {
          const containsIsland = shapes.some(
            (other, i) => i !== index && pathsOf(makePath(other.d)).some((p) => p.clockwise && path.bounds.contains(p.bounds) && path.contains(p.interiorPoint)),
          );
          if (!containsIsland) {
            filled.push(path.pathData);
            return false;
          }
        }
        return true;
      });
      result.push({ d: retained.map((p) => p.pathData).join(" ") });
    }
  });
  return { shapes: result, removed, filled };
}
