// Builds a full `<tile_name>_analysis` bundle (zip) from a Sections-tab-built
// ParsedTile, the same schema-4 folder the Grasshopper engine writes (docs/DATA_FORMAT.md
// sections 3 and 12-13): voxels including the floor plates and rooms, faces / sections /
// plates / spaces / structure data, the model GLBs, plan and section drawings, and print
// STL files. Everything about the tile comes from the ParsedTile that lib/tiles has
// already completed, so this and "Add tile" can never disagree. Deliberately data-complete rather than
// decorative: every documented file a human or the app itself would
// actually use is here (manifest, README, voxels, the richer faces/sections
// JSON with outlines, every face/section/projection image, SVGs); the
// cube-net montage and per-axis contact-sheet montages are skipped (an
// explicit scope call, not an oversight -- they're convenience collages of
// images already in the bundle, not unique data). `voxels/softness.u8` is
// also omitted: voxelize.ts's own header comment already explains there's
// no real "softness" for a lofted shape, and this exporter won't fabricate
// one either.

import JSZip from "jszip";
import type { FaceEntry, FaceName, ParsedTile, SectionEntry } from "@/lib/types";
import { traceContours, type Contour } from "./contours";
import { SECTION_CELL_FT } from "./voxelize";
import { renderTileThumbnail } from "@/lib/renderTile";
import { drawingSet } from "@/lib/drawing/exportSet";
import { buildStl } from "@/lib/exporters/stl";
import { ANALYSIS_VERSION } from "@/lib/tiles/analyze";

const PX_PER_FT = 50;
const FOAM_RGB: [number, number, number] = [240, 170, 205];
const VOID_RGB: [number, number, number] = [20, 20, 34];

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.+-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "tile";
}

// ---------------------------------------------------------------- canvas/PNG

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return { canvas, ctx };
}

function canvasToPngArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Couldn't rasterize to PNG"));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, "image/png");
  });
}

/** Rasterizes a boolean/0-1 2D grid (rows x cols) to a PNG, `1` cells
 * colored `onColor`, `0` cells `offColor`, each cell drawn as a solid
 * `scale`x`scale` px block (matches the Python engine's own `upscale()` ->
 * nearest-neighbor block convention for mask/color images). */
async function gridToPng(grid: ArrayLike<number>, rows: number, cols: number, onColor: [number, number, number], offColor: [number, number, number], scale: number): Promise<ArrayBuffer> {
  const { canvas, ctx } = newCanvas(cols * scale, rows * scale);
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = !!grid[r * cols + c];
      const [cr, cg, cb] = on ? onColor : offColor;
      for (let sy = 0; sy < scale; sy++) {
        const py = r * scale + sy;
        for (let sx = 0; sx < scale; sx++) {
          const px = c * scale + sx;
          const idx = (py * canvas.width + px) * 4;
          image.data[idx] = cr;
          image.data[idx + 1] = cg;
          image.data[idx + 2] = cb;
          image.data[idx + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvasToPngArrayBuffer(canvas);
}

/** Grayscale PNG from a 0..max value grid -- used for depth maps and
 * thickness projections (brighter = larger value), matching the Python
 * engine's own depth/projection image convention. */
async function heatToPng(grid: ArrayLike<number>, rows: number, cols: number, max: number, scale: number): Promise<ArrayBuffer> {
  const { canvas, ctx } = newCanvas(cols * scale, rows * scale);
  const image = ctx.createImageData(canvas.width, canvas.height);
  const denom = max > 0 ? max : 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Math.round((Math.min(max, grid[r * cols + c]) / denom) * 255);
      for (let sy = 0; sy < scale; sy++) {
        const py = r * scale + sy;
        for (let sx = 0; sx < scale; sx++) {
          const px = c * scale + sx;
          const idx = (py * canvas.width + px) * 4;
          image.data[idx] = v;
          image.data[idx + 1] = v;
          image.data[idx + 2] = v;
          image.data[idx + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvasToPngArrayBuffer(canvas);
}

function parseMaskRows(rows: string[]): { grid: Uint8Array; rowCount: number; colCount: number } {
  const rowCount = rows.length;
  const colCount = rows[0]?.length ?? 0;
  const grid = new Uint8Array(rowCount * colCount);
  for (let r = 0; r < rowCount; r++) {
    const row = rows[r];
    for (let c = 0; c < colCount; c++) grid[r * colCount + c] = row[c] === "1" ? 1 : 0;
  }
  return { grid, rowCount, colCount };
}

function contoursToSvg(contours: Contour[], widthFt: number, heightFt: number, title: string): string {
  const paths = contours
    .map((c) => "M " + c.map((p) => `${p.u.toFixed(3)} ${(heightFt - p.v).toFixed(3)}`).join(" L ") + " Z")
    .join(" ");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthFt.toFixed(3)}in" height="${heightFt.toFixed(3)}in" viewBox="0 0 ${widthFt.toFixed(3)} ${heightFt.toFixed(3)}">\n` +
    `<title>${title}</title>\n` +
    `<rect x="0" y="0" width="${widthFt.toFixed(3)}" height="${heightFt.toFixed(3)}" fill="rgb(${FOAM_RGB.join(",")})"/>\n` +
    `<path d="${paths}" fill="rgb(${VOID_RGB.join(",")})" fill-rule="evenodd" stroke="rgb(255,255,255)" stroke-width="0.03"/>\n` +
    `<rect x="0" y="0" width="${widthFt.toFixed(3)}" height="${heightFt.toFixed(3)}" fill="none" stroke="rgb(0,0,0)" stroke-width="0.05"/>\n` +
    `</svg>\n`
  );
}

// ------------------------------------------------------------- face depth

interface AxisInfo {
  rows: number;
  cols: number;
  depthLength: number;
  indexAt: (row: number, col: number, depth: number) => number;
}

/** Only the 6 box-axis-aligned faces (and, via voxelize.ts's own axis
 * remap, a hex-prism's "top"/"bottom") have a meaningful inward-scan axis
 * in this app's axis-aligned voxel grid -- a hex side face is angled
 * relative to the grid, so it has no single "depth axis" to scan. Those
 * faces still get mask_rows + an outline (from the mask alone), just not
 * depth_cells/max_depth_ft/edges/plane. */
function axisInfoForFace(face: FaceName, grid: [number, number, number]): AxisInfo | null {
  const [nx, ny, nz] = grid;
  if (face === "-X" || face === "+X") {
    const dir = face === "-X" ? 1 : -1;
    const x0 = face === "-X" ? 0 : nx - 1;
    return { rows: ny, cols: nz, depthLength: nx, indexAt: (row, col, depth) => ((x0 + dir * depth) * ny + row) * nz + col };
  }
  if (face === "-Y" || face === "+Y") {
    const dir = face === "-Y" ? 1 : -1;
    const y0 = face === "-Y" ? 0 : ny - 1;
    return { rows: nx, cols: nz, depthLength: ny, indexAt: (row, col, depth) => (row * ny + (y0 + dir * depth)) * nz + col };
  }
  if (face === "-Z" || face === "+Z" || face === "bottom" || face === "top") {
    const dir = face === "-Z" || face === "bottom" ? 1 : -1;
    const z0 = face === "-Z" || face === "bottom" ? 0 : nz - 1;
    return { rows: nx, cols: ny, depthLength: nz, indexAt: (row, col, depth) => (row * ny + col) * nz + (z0 + dir * depth) };
  }
  return null;
}

function depthCells(voidVoxels: Uint8Array, info: AxisInfo): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < info.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < info.cols; c++) {
      let depth = 0;
      while (depth < info.depthLength && voidVoxels[info.indexAt(r, c, depth)]) depth++;
      row.push(depth);
    }
    out.push(row);
  }
  return out;
}

function edgeRows(rows: string[]): { top: string; bottom: string; left: string; right: string } {
  const left = rows.map((r) => r[0] ?? "0").join("");
  const right = rows.map((r) => r[r.length - 1] ?? "0").join("");
  return { top: rows[0] ?? "", bottom: rows[rows.length - 1] ?? "", left, right };
}

/** Face-plane metadata (origin/axes/size), derived from the orientation
 * rules docs/DATA_FORMAT.md section 3 states for each box face -- used by
 * data/faces.json's `plane` field. Box faces and hex top/bottom only (see
 * axisInfoForFace). */
function facePlane(face: FaceName, tileFt: [number, number, number], widthFt: number, heightFt: number) {
  const [tx, ty, tz] = tileFt;
  const defs: Partial<Record<FaceName, { origin: number[]; u: number[]; v: number[] }>> = {
    "-X": { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    "+X": { origin: [tx, ty, 0], u: [0, -1, 0], v: [0, 0, 1] },
    "-Y": { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
    "+Y": { origin: [tx, ty, 0], u: [-1, 0, 0], v: [0, 0, 1] },
    "+Z": { origin: [0, 0, tz], u: [1, 0, 0], v: [0, 1, 0] },
    top: { origin: [0, 0, tz], u: [1, 0, 0], v: [0, 1, 0] },
    "-Z": { origin: [tx, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
    bottom: { origin: [tx, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
  };
  const def = defs[face];
  if (!def) return undefined;
  return {
    seen_from: face,
    origin_ft: def.origin,
    u_axis: def.u,
    v_axis: def.v,
    width_ft: widthFt,
    height_ft: heightFt,
    size_px: [Math.round(widthFt * PX_PER_FT), Math.round(heightFt * PX_PER_FT)],
    px_per_ft: PX_PER_FT,
  };
}

// ---------------------------------------------------------------- assembly

export interface AnalysisExportResult {
  blob: Blob;
  fileCount: number;
}

export async function buildAnalysisZip(tile: ParsedTile): Promise<AnalysisExportResult> {
  const zip = new JSZip();
  const root = `${safeName(tile.name)}_analysis`;
  const grid = tile.grid;
  const voidVoxels = tile.voxels.void;
  if (!voidVoxels) throw new Error("This tile has no void voxel data to export.");

  // --- model/<name>.glb -- re-fetch the already-built GLB's own bytes.
  const glbBuffer = await fetch(tile.glbUrl).then((r) => r.arrayBuffer());
  zip.file(`${root}/model/${safeName(tile.name)}.glb`, glbBuffer);
  // the floor plates (and branches) as their own mesh, when the tile has them
  if (tile.partsUrl) {
    const partsBuffer: ArrayBuffer = await fetch(tile.partsUrl).then((r) => r.arrayBuffer());
    zip.file(`${root}/model/${safeName(tile.name)}_parts.glb`, partsBuffer);
  }

  // --- voxels/*.u8
  zip.file(`${root}/voxels/void.u8`, tile.voxels.void ?? new Uint8Array());
  if (tile.voxels.material) zip.file(`${root}/voxels/material.u8`, tile.voxels.material);
  if (tile.voxels.voidSmooth) zip.file(`${root}/voxels/void_smooth.u8`, tile.voxels.voidSmooth);
  if (tile.voxels.plates) zip.file(`${root}/voxels/plates.u8`, tile.voxels.plates);
  if (tile.voxels.struts) zip.file(`${root}/voxels/struts.u8`, tile.voxels.struts);
  if (tile.voxels.mask) zip.file(`${root}/voxels/mask.u8`, tile.voxels.mask);
  if (tile.voxels.rooms) zip.file(`${root}/voxels/rooms.u8`, tile.voxels.rooms);

  // --- data/faces.json (richer than the live ParsedTile's own -- outlines
  // for every face via the mask it already carries, plus depth/edges/plane
  // for the axis-aligned ones).
  const faceNames = tile.faceNames ?? ["-X", "+X", "-Y", "+Y", "-Z", "+Z"];
  const richFaces: Partial<Record<FaceName, FaceEntry>> = {};
  for (const face of faceNames) {
    const existing = tile.faces?.faces[face];
    const rows = existing?.mask_rows;
    if (!rows || !rows.length) continue;
    const { grid: maskGrid, rowCount, colCount } = parseMaskRows(rows);
    const outline = traceContours(maskGrid, rowCount, colCount, SECTION_CELL_FT);
    const entry: FaceEntry = { ...existing, outline_uv_ft: outline.map((c) => c.map((p) => [p.u, p.v])) };

    const axisInfo = axisInfoForFace(face, grid);
    if (axisInfo) {
      const depths = depthCells(voidVoxels, axisInfo);
      const maxDepth = Math.max(0, ...depths.flat());
      entry.depth_cells = depths;
      entry.max_depth_ft = maxDepth * SECTION_CELL_FT;
      entry.edges = edgeRows(rows);
      const widthFt = colCount * SECTION_CELL_FT;
      const heightFt = rowCount * SECTION_CELL_FT;
      entry.plane = facePlane(face, tile.tileFt, widthFt, heightFt);

      // images/faces/*
      const scale = 4;
      zip.file(`${root}/images/faces/face_${safeName(face)}.png`, await gridToPng(maskGrid, rowCount, colCount, VOID_RGB, FOAM_RGB, scale));
      zip.file(`${root}/images/faces/face_${safeName(face)}_mask.png`, await gridToPng(maskGrid, rowCount, colCount, [255, 255, 255], [0, 0, 0], scale));
      zip.file(`${root}/images/faces/face_${safeName(face)}_depth.png`, await heatToPng(depths.flat(), rowCount, colCount, Math.max(1, maxDepth), scale));
      zip.file(`${root}/vector/faces/face_${safeName(face)}.svg`, contoursToSvg(outline, widthFt, heightFt, `${tile.name} -- face ${face}`));
    } else {
      // Hex side faces: mask + outline only, no depth/plane (see axisInfoForFace).
      const widthFt = colCount * SECTION_CELL_FT;
      const heightFt = rowCount * SECTION_CELL_FT;
      zip.file(`${root}/vector/faces/face_${safeName(face)}.svg`, contoursToSvg(outline, widthFt, heightFt, `${tile.name} -- face ${face}`));
    }
    richFaces[face] = entry;
  }
  zip.file(`${root}/data/faces.json`, JSON.stringify({ schema: tile.faces?.schema ?? "erosion-tile/3", cell_ft: SECTION_CELL_FT, faces: richFaces }, null, 2));

  // --- data/sections.json (richer: outline_uv_ft + plane + seen_from per
  // slice, on top of whatever the live tile already computed).
  const richSections: SectionEntry[] = [];
  const axisChars: Array<"X" | "Y" | "Z"> = ["X", "Y", "Z"];
  for (const entry of tile.sections?.sections ?? []) {
    richSections.push(entry);
  }
  // Re-derive each slice's own 2D mask (not retained by computeSectionsData)
  // to trace its outline and write its image.
  for (const axis of axisChars) {
    const axisIndex = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
    const n = grid[axisIndex];
    const entriesForAxis = richSections.filter((s) => s.axis === axis);
    for (const entry of entriesForAxis) {
      const index = Math.min(n - 1, Math.round((entry.position_ft / SECTION_CELL_FT) * 1 - 0.5));
      const { rows, cols, maskAt } = sliceLayout(grid, axis, Math.max(0, Math.min(n - 1, index)));
      const maskGrid = new Uint8Array(rows * cols);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) maskGrid[r * cols + c] = voidVoxels[maskAt(r, c)] ? 1 : 0;
      const widthFt = cols * SECTION_CELL_FT;
      const heightFt = rows * SECTION_CELL_FT;
      const outline = traceContours(maskGrid, rows, cols, SECTION_CELL_FT);
      entry.outline_uv_ft = outline.map((c) => c.map((p) => [p.u, p.v]));
      entry.seen_from = `${axis}${entry.index}`;
      entry.plane = { seen_from: `${axis}${entry.index}`, origin_ft: [0, 0, 0], u_axis: [1, 0, 0], v_axis: [0, 1, 0], width_ft: widthFt, height_ft: heightFt, size_px: [Math.round(widthFt * PX_PER_FT), Math.round(heightFt * PX_PER_FT)], px_per_ft: PX_PER_FT };

      const scale = 4;
      const label = `${axis.toLowerCase()}_${String(entry.index).padStart(2, "0")}_at_${entry.position_ft.toFixed(1)}ft`;
      zip.file(`${root}/images/sections/${label}.png`, await gridToPng(maskGrid, rows, cols, VOID_RGB, FOAM_RGB, scale));
      zip.file(`${root}/images/sections/${label}_mask.png`, await gridToPng(maskGrid, rows, cols, [255, 255, 255], [0, 0, 0], scale));
      zip.file(`${root}/vector/sections/${label}.svg`, contoursToSvg(outline, widthFt, heightFt, `${tile.name} -- section ${label}`));
    }
  }
  zip.file(`${root}/data/sections.json`, JSON.stringify({ schema: tile.sections?.schema ?? "section-field-tile/1", sections: richSections }, null, 2));

  // --- data/plates.json, spaces.json, structure.json: the tile read as architecture (lib/tiles), as the engine writes them
  if (tile.plates?.length) zip.file(`${root}/data/plates.json`, JSON.stringify({ schema: "erosion-tile/4", note: "Floor plates derived from the plate cells of voxels/plates.u8 (the engine writes this analytically).", plates: tile.plates }, null, 2));
  if (tile.spaces) zip.file(`${root}/data/spaces.json`, JSON.stringify({ schema: "erosion-tile/4", ...tile.spaces, cell_ft: tile.cellFt }, null, 2));
  if (tile.structure) zip.file(`${root}/data/structure.json`, JSON.stringify({ schema: "erosion-tile/4", analysis_version: ANALYSIS_VERSION, cell_ft: tile.cellFt, structure: tile.structure }, null, 2));

  // --- vector/drawings: a plan of every level and sections along X and Y (poche, 1 in = 10 ft)
  for (const f of drawingSet(tile)) zip.file(`${root}/${f.path}`, f.svg);

  // --- print/: foam and void as STL at 1 inch = 10 feet (the Viewer's Print panel offers other scales and parts)
  try {
    const stl = await buildStl(tile, ["foam", "void"], 120, false);
    for (const f of stl.files) zip.file(`${root}/print/${f.name}`, f.blob);
  } catch {
    // Non-essential -- skip rather than fail the whole export.
  }

  // --- images/projections/void_thickness_along_<axis>.png -- a straight
  // count-projection (not the engine's own log/lognormal palette, just a
  // linear 0..axisLength heat), matching the documented "white = void all
  // the way through" convention directionally if not pixel-for-pixel.
  const [nx, ny, nz] = grid;
  for (const axis of axisChars) {
    const axisIndex = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
    const { rows, cols } = projectionLayout(grid, axis);
    const counts = new Float64Array(rows * cols);
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) {
          if (!voidVoxels[(x * ny + y) * nz + z]) continue;
          const [r, c] = projectionCell(axis, x, y, z);
          counts[r * cols + c] += 1;
        }
    zip.file(`${root}/images/projections/void_thickness_along_${axis.toLowerCase()}.png`, await heatToPng(counts, rows, cols, grid[axisIndex], 4));
  }

  // --- images/thumbnail.png -- reuse the same render-to-canvas path every
  // other tile-bank thumbnail in the app already goes through.
  try {
    const dataUrl = await renderTileThumbnail(tile.glbUrl, 512);
    const thumbBuffer = await fetch(dataUrl).then((r) => r.arrayBuffer());
    zip.file(`${root}/images/thumbnail.png`, thumbBuffer);
  } catch {
    // Non-essential -- skip rather than fail the whole export.
  }

  // --- tile.json
  const tileJson = {
    schema: tile.schema ?? "section-field-tile/1",
    id: tile.id,
    name: tile.name,
    exported: new Date().toISOString(),
    engine_version: tile.engineVersion ?? "section-field-builder",
    units: "feet",
    coordinate_system: "x,y horizontal, z up, origin at tile low corner",
    tile_ft: tile.tileFt,
    cell_ft: tile.cellFt,
    grid: tile.grid,
    config: tile.config,
    metrics: tile.metrics,
    origin_ft: [0, 0, 0],
    container: { kind: tile.shape?.kind === "hex-prism" ? "hex-prism" : "cube", volume_ft3: tile.metrics.tile_volume_ft3 },
    meta: tile.meta ?? (tile.guessed.category ? { category: tile.guessed.category, typology: tile.guessed.typology } : undefined),
    levels: tile.spaces?.levels.map((l) => ({ id: l.id, name: l.name, z_ft: l.z_ft, area_ft2: l.area_ft2, kind: l.kind })),
    analysis: tile.spaces ? { version: ANALYSIS_VERSION, spaces_file: "data/spaces.json", structure_file: "data/structure.json", rooms_file: tile.voxels.rooms ? "voxels/rooms.u8" : undefined } : undefined,
    plates_file: tile.plates?.length ? "data/plates.json" : undefined,
    recipe_file: tile.sectionRecipe ? "recipe.json" : undefined,
  };
  zip.file(`${root}/tile.json`, JSON.stringify(tileJson, null, 2));
  // --- recipe.json: the builder's own recipe (which bank tile on which face, seed, cleanup, plates), enough to reopen or rebuild it
  if (tile.sectionRecipe) zip.file(`${root}/recipe.json`, JSON.stringify({ schema: "section-field-recipe/1", name: tile.name, meta: tileJson.meta, builder: tile.sectionRecipe }, null, 2));

  // --- manifest.json -- the "start here" file list + roles.
  const fileList = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  const manifest = {
    schema: "erosion-tile-manifest/1",
    tile_id: tile.id,
    name: tile.name,
    generated_by: "D7-Program Sections tab (cube/hex builder)",
    generated_at: new Date().toISOString(),
    files: fileList.map((path) => ({ path: path.slice(root.length + 1), role: manifestRole(path) })),
    notes: [
      "Built from a browser-side loft, not a real erosion simulation -- void/foam are geometry, not a physical accretion/dissolve history.",
      "voxels/softness.u8 is intentionally omitted: there is no physical 'softness' for a lofted shape to report.",
      "A cube-net montage and per-axis contact sheets (present in a real Grasshopper export) were intentionally skipped here -- convenience collages of images already in this bundle, not unique data.",
    ],
  };
  zip.file(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));

  // --- README.txt
  zip.file(
    `${root}/README.txt`,
    `${tile.name}\n` +
      `Built in-browser from the Sections tab's cube/hex builder, exported to match a Grasshopper erosion-engine tile bundle (docs/DATA_FORMAT.md).\n\n` +
      `tile_ft: ${tile.tileFt.join(" x ")}   cell_ft: ${tile.cellFt}   grid: ${tile.grid.join("x")}\n` +
      `void_fraction: ${tile.metrics.void_fraction?.toFixed?.(3) ?? tile.metrics.void_fraction}\n\n` +
      `See manifest.json for the full file list and what each one is. data/spaces.json and data/structure.json read the tile as architecture (levels, rooms, routes, daylight, structure); vector/drawings holds its plans and sections; print/ holds STL files at 1 inch = 10 feet.\n`,
  );

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, fileCount: fileList.length };
}

function manifestRole(path: string): string {
  if (path.endsWith("tile.json")) return "identity, settings, measurements";
  if (path.endsWith("manifest.json")) return "this file";
  if (path.includes("/model/") && path.endsWith("_parts.glb")) return "floor plates and branches as separate meshes (parts of the foam)";
  if (path.includes("/model/")) return "foam + void mesh for three.js";
  if (path.includes("voxels/plates.u8")) return "floor plate id per cell (these cells are foam in void.u8)";
  if (path.includes("voxels/struts.u8")) return "support branches (foam in void.u8)";
  if (path.includes("voxels/rooms.u8")) return "which room each void cell belongs to (data/spaces.json)";
  if (path.includes("voxels/mask.u8")) return "inside-the-container mask";
  if (path.includes("data/plates.json")) return "each floor plate: position, slope, thickness, clear height above and below";
  if (path.includes("data/spaces.json")) return "the void as spaces: levels, rooms, connections, routes, daylight, face openings";
  if (path.includes("data/structure.json")) return "foam pieces, thin-wall shares, overhang and bed contact";
  if (path.includes("vector/drawings/")) return "plan or section drawing (poche), 1 in = 10 ft";
  if (path.includes("/print/")) return "STL for 3D printing, millimetres, Z up";
  if (path.endsWith("recipe.json")) return "the builder recipe (faces, seed, cleanup, plates)";
  if (path.includes("/voxels/void.u8")) return "void/foam raw voxel grid, 1=void";
  if (path.includes("/voxels/material.u8")) return "foam material grid, 0..255";
  if (path.includes("/voxels/void_smooth.u8")) return "smoothed void grid, 0..255";
  if (path.includes("data/faces.json")) return "per-face mask/depth/outline data";
  if (path.includes("data/sections.json")) return "per-slice void area/outline data";
  if (path.includes("images/faces/") && path.endsWith("_mask.png")) return "face void mask (white=void)";
  if (path.includes("images/faces/") && path.endsWith("_depth.png")) return "face depth map (brighter=deeper)";
  if (path.includes("images/faces/")) return "face color image (pink=foam, dark=void)";
  if (path.includes("images/sections/") && path.endsWith("_mask.png")) return "section void mask";
  if (path.includes("images/sections/")) return "section color image";
  if (path.includes("images/projections/")) return "void-thickness projection (white=thicker)";
  if (path.includes("images/thumbnail.png")) return "identifying thumbnail";
  if (path.includes("vector/")) return "vector outline (1in = 1ft)";
  if (path.endsWith("README.txt")) return "plain-language description";
  return "see docs/DATA_FORMAT.md";
}

function sliceLayout(grid: [number, number, number], axis: "X" | "Y" | "Z", index: number) {
  const [nx, ny, nz] = grid;
  if (axis === "X") return { rows: ny, cols: nz, maskAt: (r: number, c: number) => (index * ny + r) * nz + c };
  if (axis === "Y") return { rows: nx, cols: nz, maskAt: (r: number, c: number) => (r * ny + index) * nz + c };
  return { rows: nx, cols: ny, maskAt: (r: number, c: number) => (r * ny + c) * nz + index };
}

function projectionLayout(grid: [number, number, number], axis: "X" | "Y" | "Z") {
  const [nx, ny, nz] = grid;
  if (axis === "X") return { rows: ny, cols: nz };
  if (axis === "Y") return { rows: nx, cols: nz };
  return { rows: nx, cols: ny };
}

function projectionCell(axis: "X" | "Y" | "Z", x: number, y: number, z: number): [number, number] {
  if (axis === "X") return [y, z];
  if (axis === "Y") return [x, z];
  return [x, y];
}
