// Smooth, high-detail meshes for pictures, films and model files.
//
// The engine's meshes are cut from a 40 x 40 x 40 field, which looks faceted when it is rendered large or exported. A tile's voxels
// are rebuilt into a finer surface (lib/exporters/printMesh.ts) in the engine's own glTF frame, and swapped into a scene for as long as
// a capture or an export takes (the live viewports keep the light engine meshes). Geometry is cached per tile, so a hundred pieces of
// the same tile share one.

import * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import { fineMesh, type Detail } from "@/lib/exporters/printMesh";

/** How fine an export or film is: 0 = the engine's own mesh. */
export type Quality = 0 | Detail;
export const QUALITY_CHOICES: { value: Quality; label: string }[] = [
  { value: 3, label: "High (smooth)" },
  { value: 4, label: "Maximum (slowest)" },
  { value: 2, label: "Standard" },
  { value: 0, label: "Original engine mesh" },
];

const cache = new WeakMap<ParsedTile, Map<string, THREE.BufferGeometry | null>>();
/** Most meshes kept at once (a mesh is a few megabytes): the oldest are dropped, and rebuilt in a fraction of a second if needed again. */
const KEEP = 32;
const order: { perTile: Map<string, THREE.BufferGeometry | null>; key: string }[] = [];

/** The engine writes metres, Y up, with the tile's Y flipped; the Sections builder writes feet, Y up. */
const isBuilder = (t: ParsedTile) => !!t.schema?.startsWith("section-field") || t.engineVersion === "section-field-builder";

/** The foam or the void of a tile as a smooth BufferGeometry in the tile's glTF frame, or null when it has no voxels. */
export function fineGeometry(tile: ParsedTile, solid: "foam" | "void", detail: Detail): THREE.BufferGeometry | null {
  let perTile = cache.get(tile);
  if (!perTile) {
    perTile = new Map();
    cache.set(tile, perTile);
  }
  const key = `${solid}|${detail}`;
  if (perTile.has(key)) return perTile.get(key)!;
  const m = fineMesh(tile, 304.8, detail, solid); // 304.8 makes the units feet
  let geo: THREE.BufferGeometry | null = null;
  if (m) {
    const n = m.positions.length / 3;
    const pos = new Float32Array(n * 3);
    const builder = isBuilder(tile);
    for (let v = 0; v < n; v++) {
      const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      if (builder) {
        pos[v * 3] = x;
        pos[v * 3 + 1] = z;
        pos[v * 3 + 2] = y;
      } else {
        pos[v * 3] = x * 0.3048;
        pos[v * 3 + 1] = z * 0.3048;
        pos[v * 3 + 2] = -y * 0.3048;
      }
    }
    const index = new Uint32Array(m.indices);
    if (builder)
      // swapping two axes mirrors the mesh, which turns the triangles inside out
      for (let t = 0; t < index.length; t += 3) {
        const a = index[t + 1];
        index[t + 1] = index[t + 2];
        index[t + 2] = a;
      }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
  }
  perTile.set(key, geo);
  order.push({ perTile, key });
  while (order.length > KEEP) {
    const old = order.shift()!;
    old.perTile.get(old.key)?.dispose();
    old.perTile.delete(old.key);
  }
  return geo;
}

/** Puts the fine foam and void into the meshes named "foam" and "void" under `root`; returns the undo. A tile without voxels is left alone. */
export function refineMeshes(root: THREE.Object3D, tile: ParsedTile, detail: Quality): () => void {
  if (!detail) return () => {};
  const undo: (() => void)[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || (o.name !== "foam" && o.name !== "void")) return;
    const geo = fineGeometry(tile, o.name, detail);
    if (!geo) return;
    const before = o.geometry;
    o.geometry = geo;
    undo.push(() => {
      o.geometry = before;
    });
  });
  return () => undo.forEach((f) => f());
}

/** Refines every object that carries `userData.tileId` (a placed piece, a viewport's tile) using the matching tile. */
export function refineByTileId(scene: THREE.Object3D, tileById: Map<string, ParsedTile>, detail: Quality): () => void {
  if (!detail) return () => {};
  const undo: (() => void)[] = [];
  scene.traverse((o) => {
    const id = o.userData?.tileId as string | undefined;
    const tile = id ? tileById.get(id) : undefined;
    if (tile) undo.push(refineMeshes(o, tile, detail));
  });
  return () => undo.forEach((f) => f());
}
