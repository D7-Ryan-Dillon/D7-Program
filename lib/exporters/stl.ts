// Print-ready STL of a tile at a chosen scale: pick the parts (foam, void, floor plates, support branches), one file each or
// merged into one. Binary STL, millimetres, Z up, the tile's low corner at the origin. The foam is the physical block;
// the void is its negative (for casting or study models). Plates and branches are parts of the foam, offered separately.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ParsedTile } from "@/lib/types";

export type StlPart = "foam" | "void" | "plates" | "struts";
export const STL_PARTS: { key: StlPart; label: string; hint: string }[] = [
  { key: "foam", label: "Foam", hint: "the whole solid block, plates and branches included" },
  { key: "void", label: "Void", hint: "the negative: the rooms as a solid, for casting or study models" },
  { key: "plates", label: "Floor plates", hint: "only the plates (they are part of the foam)" },
  { key: "struts", label: "Branches", hint: "only the support branches (part of the foam)" },
];

const loader = new GLTFLoader();

interface Tri {
  /** x, y, z of three vertices, millimetres, Z up */
  v: Float32Array;
}

/** Triangles of one named mesh, in millimetres with Z up and the tile's low corner at 0. */
async function trianglesOf(tile: ParsedTile, url: string, node: StlPart, ratio: number): Promise<Tri> {
  const gltf = await loader.loadAsync(url);
  const mesh = gltf.scene.getObjectByName(node);
  if (!(mesh instanceof THREE.Mesh)) return { v: new Float32Array(0) };
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const builder = !!tile.schema?.startsWith("section-field") || tile.engineVersion === "section-field-builder";
  // glTF position -> tile feet (Z up). The engine writes metres, Y up, y flipped; the Sections builder writes feet, Y up.
  const toFt = (x: number, y: number, z: number): [number, number, number] => (builder ? [x, z, y] : [x / 0.3048, -z / 0.3048, y / 0.3048]);
  const mm = 304.8 / ratio;
  const n = index ? index.count : pos.count;
  const out = new Float32Array(n * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const vi = index ? index.getX(i) : i;
    p.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mesh.matrixWorld);
    const [fx, fy, fz] = toFt(p.x, p.y, p.z);
    out[i * 3] = fx * mm;
    out[i * 3 + 1] = fy * mm;
    out[i * 3 + 2] = fz * mm;
  }
  return { v: out };
}

function binaryStl(tris: Float32Array[], label: string): { blob: Blob; triangles: number } {
  const count = tris.reduce((a, t) => a + t.length / 9, 0);
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const head = `erosion workspace ${label} (mm, Z up)`;
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
  dv.setUint32(80, count, true);
  let o = 84;
  for (const t of tris)
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const wx = t[i + 6] - t[i], wy = t[i + 7] - t[i + 1], wz = t[i + 8] - t[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, t[i + k], true);
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
  return { blob: new Blob([buf], { type: "model/stl" }), triangles: count };
}

/** Signed volume of a closed triangle soup, mm3. */
function volumeMm3(t: Float32Array): number {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

/** Edges used by exactly one triangle (a hole) -- 0 means watertight. Vertices are matched to 1/1000 mm. */
function openEdges(t: Float32Array): number {
  const key = (i: number) => `${Math.round(t[i] * 1000)},${Math.round(t[i + 1] * 1000)},${Math.round(t[i + 2] * 1000)}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < t.length; i += 9) {
    const k = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = k[e];
      const b = k[(e + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const c of edges.values()) if (c % 2 === 1) open++;
  return open;
}

export interface StlFile {
  name: string;
  blob: Blob;
  triangles: number;
  parts: StlPart[];
}

export interface StlResult {
  files: StlFile[];
  /** printed size of the tile, mm */
  sizeMm: [number, number, number];
  /** per part: solid volume in cm3 and open edges */
  perPart: { part: StlPart; volumeCm3: number; triangles: number; openEdges: number }[];
  warnings: string[];
}

/** Which parts this tile can offer (plates and branches only when it has them). */
export function availableParts(tile: ParsedTile): StlPart[] {
  const out: StlPart[] = ["foam", "void"];
  if (tile.partsUrl) {
    out.push("plates");
    if (tile.voxels.struts) out.push("struts");
  }
  return out;
}

export async function buildStl(tile: ParsedTile, parts: StlPart[], ratio: number, merge: boolean): Promise<StlResult> {
  const warnings: string[] = [];
  const mm = 304.8 / ratio;
  const got: { part: StlPart; tri: Float32Array }[] = [];
  for (const part of parts) {
    const url = part === "plates" || part === "struts" ? tile.partsUrl : tile.glbUrl;
    if (!url) continue;
    const { v } = await trianglesOf(tile, url, part, ratio);
    if (!v.length) warnings.push(`${part}: the tile has no such mesh.`);
    else got.push({ part, tri: v });
  }
  const perPart = got.map(({ part, tri }) => ({ part, volumeCm3: volumeMm3(tri) / 1000, triangles: tri.length / 9, openEdges: tri.length / 9 < 400000 ? openEdges(tri) : -1 }));
  for (const p of perPart) if (p.openEdges > 0) warnings.push(`${p.part}: ${p.openEdges} open edges, so the mesh is not watertight; a slicer may need to repair it.`);
  const stem = tile.name.replace(/[^A-Za-z0-9_.+-]+/g, "_");
  const tag = `1to${Math.round(ratio)}`;
  const files: StlFile[] = [];
  if (merge && got.length > 1) {
    const { blob, triangles } = binaryStl(got.map((g) => g.tri), got.map((g) => g.part).join("+"));
    files.push({ name: `${stem}_${got.map((g) => g.part).join("+")}_${tag}.stl`, blob, triangles, parts: got.map((g) => g.part) });
  } else {
    for (const g of got) {
      const { blob, triangles } = binaryStl([g.tri], g.part);
      files.push({ name: `${stem}_${g.part}_${tag}.stl`, blob, triangles, parts: [g.part] });
    }
  }
  const sizeMm: [number, number, number] = [tile.tileFt[0] * mm, tile.tileFt[1] * mm, tile.tileFt[2] * mm];
  return { files, sizeMm, perPart, warnings };
}

/** Rough filament use (metres of 1.75 mm filament) for a solid volume at the given fill share. */
export function filamentMetres(volumeCm3: number, fill = 1): number {
  const area = Math.PI * 0.875 ** 2; // mm2
  return (volumeCm3 * 1000 * fill) / area / 1000;
}
