// Traces the boundary of a binary mask (e.g. a face's void mask_rows) into
// closed rectilinear polylines, in UV feet -- shared by the richer
// faces.json/sections.json outline_uv_ft fields and the exported
// vector/*.svg files (lib/sections/exportAnalysis.ts), written once rather
// than twice. Deliberately rectilinear (cell-edge-aligned), not smoothed:
// the source data is itself a voxel/cell grid, so a blocky outline is an
// honest representation of its actual resolution, and it sidesteps the
// ambiguous-saddle-case bugs a smoothed marching-squares tracer would need
// to handle carefully for comparatively little visual benefit here.
//
// Every boundary edge between a "void" cell and a non-void (or
// out-of-bounds) neighbor is collected, then chained into closed loops by
// following shared endpoints. Outer boundaries and inner hole boundaries
// both come out as plain closed loops with no special winding-direction
// handling needed, since every consumer fills with the even-odd rule
// (matching volumeField.ts's own faceMask() and the Grasshopper engine's
// write_svg) -- nesting, not winding, is what makes a hole read as a hole.

export interface ContourPoint {
  u: number;
  v: number;
}
export type Contour = ContourPoint[];

interface Edge {
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * `mask`: row-major boolean/0-1 grid, `mask[row*cols+col]`, true = void.
 * `cellFt`: real-world size of one cell, in feet.
 * Returns closed polygons (last point not repeated) in UV feet, with
 * row 0 as the top edge (u = col*cellFt, v = (rows-row)*cellFt) -- matching
 * this app's own face-image convention (docs/DATA_FORMAT.md: "Row 0 is the
 * top edge").
 */
export function traceContours(mask: ArrayLike<number>, rows: number, cols: number, cellFt: number): Contour[] {
  const at = (r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols && !!mask[r * cols + c];

  // Lattice point (x, y) for cell-corner (col=x, row=y); v is flipped so
  // row 0 (top) maps to the largest v.
  const point = (x: number, y: number): ContourPoint => ({ u: x * cellFt, v: (rows - y) * cellFt });

  const edgeMap = new Map<string, Edge[]>();
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const a = key(x1, y1);
    const b = key(x2, y2);
    const edge: Edge = { a, b, ax: x1, ay: y1, bx: x2, by: y2 };
    if (!edgeMap.has(a)) edgeMap.set(a, []);
    if (!edgeMap.has(b)) edgeMap.set(b, []);
    edgeMap.get(a)!.push(edge);
    edgeMap.get(b)!.push(edge);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(r, c)) continue;
      if (!at(r - 1, c)) addEdge(c, r, c + 1, r); // top edge of cell (r, c)
      if (!at(r + 1, c)) addEdge(c, r + 1, c + 1, r + 1); // bottom edge
      if (!at(r, c - 1)) addEdge(c, r, c, r + 1); // left edge
      if (!at(r, c + 1)) addEdge(c + 1, r, c + 1, r + 1); // right edge
    }
  }

  const visited = new Set<Edge>();
  const contours: Contour[] = [];

  for (const edges of edgeMap.values()) {
    for (const start of edges) {
      if (visited.has(start)) continue;
      const loop: ContourPoint[] = [];
      let current = start;
      let currentVertex = current.a;
      visited.add(current);
      loop.push(point(current.ax, current.ay));

      for (let guard = 0; guard < rows * cols * 4 + 8; guard++) {
        const nextVertex = currentVertex === current.a ? current.b : current.a;
        loop.push(point(...(nextVertex.split(",").map(Number) as [number, number])));
        if (nextVertex === key(start.ax, start.ay)) break;
        const candidates = edgeMap.get(nextVertex) ?? [];
        const next = candidates.find((e) => !visited.has(e));
        if (!next) break;
        visited.add(next);
        current = next;
        currentVertex = nextVertex;
      }

      // Drop the repeated closing point -- callers treat every contour as
      // an implicitly-closed loop (both the outline_uv_ft JSON convention
      // and the SVG writer's own "M ... L ... Z" path closing).
      if (loop.length > 2) contours.push(loop.slice(0, -1));
    }
  }

  return contours;
}
