// All the pieces of an arrangement pasted into one box of voxels. Everything about "the whole" -- the analysis, the
// smoothing, the mesh, the tile it becomes -- starts here.

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ParsedTile } from "@/lib/types";
import { analyzeArrangement } from "./analysisClient";
import { computeBundle, type Bundle, type BundleInput } from "./bundle";
import { blurField, surfaceNets, type MeshData } from "./surfaceNets";
import { boundsOfBoxes, toFt, type PlacedBox } from "./geometry";
import { categoryOf, type Dims } from "./orient";
import { ARRANGE_CELL, type ArrangementDoc, type Vec3 } from "./types";

export interface Composite {
  grid: Dims;
  cell: number;
  /** feet: the world position of the box's low corner */
  origin: Vec3;
  /** 1 = void (an open space); outside any piece nothing is void */
  void: Uint8Array;
  /** floor plate id per cell (0 = none) */
  plates: Uint8Array;
  struts: Uint8Array;
  /** 1 = inside some piece's container (cells claimed by no piece, including the notches of shaped pieces, stay 0) */
  mask: Uint8Array;
  /** which piece (index into pieceIds) owns each cell, -1 = none */
  owner: Int16Array;
  pieceIds: string[];
}

export function buildComposite(boxes: PlacedBox[]): Composite | null {
  const bb = boundsOfBoxes(boxes);
  if (!bb) return null;
  const grid: Dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const n = grid[0] * grid[1] * grid[2];
  const comp: Composite = {
    grid,
    cell: ARRANGE_CELL,
    origin: [toFt(bb.min[0]), toFt(bb.min[1]), toFt(bb.min[2])],
    void: new Uint8Array(n),
    plates: new Uint8Array(n),
    struts: new Uint8Array(n),
    mask: new Uint8Array(n),
    owner: new Int16Array(n).fill(-1),
    pieceIds: boxes.map((b) => b.piece.id),
  };
  let plateId = 0;
  boxes.forEach((b, k) => {
    const [nx, ny, nz] = b.o.dims;
    const ox = b.min[0] - bb.min[0];
    const oy = b.min[1] - bb.min[1];
    const oz = b.min[2] - bb.min[2];
    const ids = new Map<number, number>();
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const li = (x * ny + y) * nz;
        const gi = ((ox + x) * grid[1] + oy + y) * grid[2] + oz;
        for (let z = 0; z < nz; z++) {
          // outside this piece's container: its cell is not its own, so it never overwrites what another piece put there
          if (b.o.mask && !b.o.mask[li + z]) continue;
          const mine = b.o.void[li + z] ? 1 : 0;
          if (comp.mask[gi + z]) {
            // two pieces claim the cell (only possible when the collision policy allowed it): material wins over space, space over space stays space
            if (!comp.void[gi + z] || mine) continue;
            comp.void[gi + z] = 0;
            comp.owner[gi + z] = k;
          } else {
            comp.mask[gi + z] = 1;
            comp.owner[gi + z] = k;
            if (mine) comp.void[gi + z] = 1;
          }
          if (!mine) {
            if (b.o.plates?.[li + z]) {
              const local = b.o.plates[li + z];
              let id = ids.get(local);
              if (id === undefined) {
                id = Math.min(255, ++plateId);
                ids.set(local, id);
              }
              comp.plates[gi + z] = id;
            }
            if (b.o.struts?.[li + z]) comp.struts[gi + z] = 1;
          }
        }
      }
  });
  return comp;
}

// ---- the mesh ------------------------------------------------------------------------------------------------------

const FT_TO_M = 0.3048;

function toGeometry(mesh: MeshData, comp: Composite, pad: number): THREE.BufferGeometry {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  // engine glTF convention (metres, Y up, Y flipped): x_m = x_ft, y_m = z_ft, z_m = -y_ft
  for (let i = 0; i < p.length; i += 3) {
    const x = comp.origin[0] + (p[i] - pad + 0.5) * comp.cell;
    const y = comp.origin[1] + (p[i + 1] - pad + 0.5) * comp.cell;
    const z = comp.origin[2] + (p[i + 2] - pad + 0.5) * comp.cell;
    out[i] = x * FT_TO_M;
    out[i + 1] = z * FT_TO_M;
    out[i + 2] = -y * FT_TO_M;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}

/** A named mesh of the cells where `pick` is true. */
function meshOf(comp: Composite, pick: (i: number) => boolean, name: string, color: string, smooth: number): THREE.Mesh | null {
  const n = comp.void.length;
  const sel = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) if (pick(i)) {
    sel[i] = 1;
    any = true;
  }
  if (!any) return null;
  const pad = 2 + Math.ceil(smooth);
  const { field, dims } = blurField(sel, comp.grid, pad, smooth);
  const mesh = new THREE.Mesh(toGeometry(surfaceNets(field, dims, 0.5), comp, pad), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
  mesh.name = name;
  return mesh;
}

export interface CompositeMeshes {
  main: THREE.Group;
  parts: THREE.Group | null;
}

/** The foam and void meshes (and, when there are any, the plates and branches as their own parts), smoothed. */
export function compositeMeshes(comp: Composite, smooth = 1): CompositeMeshes {
  const main = new THREE.Group();
  const foam = meshOf(comp, (i) => comp.mask[i] === 1 && comp.void[i] === 0, "foam", "#e8a6c8", smooth);
  const voidMesh = meshOf(comp, (i) => comp.void[i] === 1 && comp.mask[i] === 1, "void", "#1c1c1c", smooth);
  if (foam) main.add(foam);
  if (voidMesh) main.add(voidMesh);
  const parts = new THREE.Group();
  const plates = meshOf(comp, (i) => comp.plates[i] !== 0 && comp.void[i] === 0, "plates", "#f2b878", smooth);
  const struts = meshOf(comp, (i) => comp.struts[i] !== 0 && comp.void[i] === 0, "struts", "#db7228", smooth);
  if (plates) parts.add(plates);
  if (struts) parts.add(struts);
  return { main, parts: parts.children.length ? parts : null };
}

async function glbUrl(group: THREE.Group): Promise<string> {
  const buf = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
}

async function hashId(bytes: Uint8Array, extra: string): Promise<string> {
  const e = new TextEncoder().encode(extra);
  const all = new Uint8Array(bytes.length + e.length);
  all.set(bytes, 0);
  all.set(e, bytes.length);
  const d = await crypto.subtle.digest("SHA-1", all);
  return Array.from(new Uint8Array(d)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CompositeTileOptions {
  name: string;
  doc: ArrangementDoc;
  /** build the smooth meshes (needed to show or add the tile; the analysis alone does not need them) */
  withMeshes: boolean;
  smooth?: number;
  /** a tile id to keep (so re-adding an arrangement updates the same tile) */
  id?: string;
  /** the reading of the voxels when the caller already has it */
  bundle?: Bundle;
}

/** The inputs the analysis reads: the combined voxels, void limited to the inside of the pieces. */
export function bundleInput(comp: Composite): BundleInput {
  const voidMasked = new Uint8Array(comp.void.length);
  for (let i = 0; i < voidMasked.length; i++) voidMasked[i] = comp.void[i] && comp.mask[i] ? 1 : 0;
  return { void: voidMasked, grid: comp.grid, cell: comp.cell, plates: comp.plates.some((v) => v) ? comp.plates.slice() : null, struts: comp.struts.some((v) => v) ? comp.struts.slice() : null, mask: comp.mask.slice() };
}

/** Reads the combined voxels off the page (null if a newer reading replaced this one). */
export const readComposite = (comp: Composite) => analyzeArrangement(bundleInput(comp));

/** The arrangement as a tile: voxels, faces, sections, metrics and the full spaces / structure analysis, and (optionally) its meshes. */
export async function compositeToTile(comp: Composite, boxes: PlacedBox[], opts: CompositeTileOptions): Promise<ParsedTile> {
  const [nx, ny, nz] = comp.grid;
  const tileFt: Vec3 = [nx * comp.cell, ny * comp.cell, nz * comp.cell];
  const input = bundleInput(comp);
  const voidMasked = input.void;
  const hasPlates = !!input.plates;
  const hasStruts = !!input.struts;
  const bundle = opts.bundle ?? (await analyzeArrangement(input)) ?? computeBundle(input);
  const sig = boxes.map((b) => `${b.piece.tileId}:${b.piece.rotZ}:${b.piece.mirrorX ? 1 : 0}:${b.piece.pos.join(",")}`).join(";");
  const id = opts.id ?? (await hashId(voidMasked, `arrangement:${sig}`));
  let glb = "";
  let parts: string | undefined;
  if (opts.withMeshes) {
    const meshes = compositeMeshes(comp, opts.smooth ?? 1);
    glb = await glbUrl(meshes.main);
    if (meshes.parts) parts = await glbUrl(meshes.parts);
  }
  const tile: ParsedTile = {
    id,
    name: opts.name,
    sourceFolderName: opts.name,
    schema: "erosion-tile/4",
    engineVersion: "arrange",
    tileFt,
    cellFt: comp.cell,
    grid: comp.grid,
    config: { seed: 0, cell: comp.cell, tile_w: tileFt[0], tile_h: tileFt[2] },
    metrics: bundle.metrics,
    glbUrl: glb,
    partsUrl: parts,
    voxels: { void: voidMasked, mask: comp.mask, plates: hasPlates ? comp.plates : undefined, struts: hasStruts ? comp.struts : undefined, rooms: bundle.rooms },
    faces: bundle.faces,
    sections: bundle.sections,
    spaces: bundle.spaces,
    structure: bundle.structure,
    plates: bundle.plates,
    guessed: {},
    meta: { category: "assembly", typology: `${boxes.length} pieces` },
  };
  return nameRooms(tile, comp, boxes, opts.doc);
}

/** Rooms take the name of the piece (the space) they are in: the user's own name when they gave one. */
function nameRooms(tile: ParsedTile, comp: Composite, boxes: PlacedBox[], doc: ArrangementDoc): ParsedTile {
  if (!tile.spaces) return tile;
  const used = new Map<string, number>();
  const rooms = tile.spaces.rooms.map((r) => {
    const [cx, cy, cz] = r.centroid_ft;
    const x = Math.min(comp.grid[0] - 1, Math.max(0, Math.floor(cx / comp.cell)));
    const y = Math.min(comp.grid[1] - 1, Math.max(0, Math.floor(cy / comp.cell)));
    const z = Math.min(comp.grid[2] - 1, Math.max(0, Math.floor(cz / comp.cell)));
    const k = comp.owner[(x * comp.grid[1] + y) * comp.grid[2] + z];
    const box = k >= 0 ? boxes[k] : null;
    if (!box) return r;
    const base = doc.names[box.piece.id] || box.tile.name;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { ...r, name: n === 1 ? base : `${base} (${n})` };
  });
  return { ...tile, spaces: { ...tile.spaces, rooms } };
}

export const tileCategoryLabel = (t: ParsedTile) => categoryOf(t);
