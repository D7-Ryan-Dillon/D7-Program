// Builds the foam + void meshes for a converted Section-Field tile, named
// exactly like a Grasshopper tile's GLB nodes ("foam" / "void" -- see
// components/viewer/ThreeViewport.tsx's `getObjectByName`) so the rest of
// the app can't tell the difference.
//
// Both meshes come from ONE marching-cubes pass over the same lofted field:
//
//   foam = the lofted solid, clipped flush to the tile's cube / hex prism
//   void = the tile's cube / hex prism MINUS the foam  (a real boolean
//          difference: a closed solid whose outer skin is the flat cube/hex
//          faces, with holes wherever the foam reaches a face, and whose
//          inner skin is the foam's own surface)
//
// Clipping to the tile shape is done in the *field* rather than on the
// mesh: the field is sampled on a small grid whose nodes straddle the tile
// boundary, and every node just outside the boundary gets the odd mirror of
// its inside neighbour, -|f|. The isosurface then crosses zero exactly on
// the boundary plane for the foam wherever foam meets the face, and for the
// void everywhere else on the face -- planar, watertight patches that share
// their edges, no mesh booleans needed. (Exactly the trick that makes the
// two meshes complementary: both are marched from the same node values, f
// for the foam and -f for the void.)

import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { SECTION_TILE_FT } from "./voxelize";
import { HEX_APOTHEM, type VolumeShape } from "./volumeField";

// Marching cubes' own triangle budget (it silently truncates past this).
const MAX_TRIANGLES = 250000;
// The lofted field's first / last real node on every axis (volumeField.ts
// forces nodes 0-1 and n-2..n-1 to void as a margin).
const EDGE = 2;

/** Trilinear sample of the lofted field at fractional node coordinates. */
function sampleNodes(field: Float32Array, n: number, gx: number, gy: number, gz: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(n - 1.001, v));
  const x = clamp(gx),
    y = clamp(gy),
    z = clamp(gz);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const dx = x - x0,
    dy = y - y0,
    dz = z - z0;
  const at = (ix: number, iy: number, iz: number) => field[iz * n * n + iy * n + ix];
  const lower = (at(x0, y0, z0) * (1 - dx) + at(x0 + 1, y0, z0) * dx) * (1 - dy) + (at(x0, y0 + 1, z0) * (1 - dx) + at(x0 + 1, y0 + 1, z0) * dx) * dy;
  const upper =
    (at(x0, y0, z0 + 1) * (1 - dx) + at(x0 + 1, y0, z0 + 1) * dx) * (1 - dy) + (at(x0, y0 + 1, z0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1, z0 + 1) * dx) * dy;
  return lower * (1 - dz) + upper * dz;
}

/** Folds a point that lies outside the tile shape back inside by mirroring
 * it across the boundary plane(s) it crossed. Returns whether it was
 * already inside. */
function reflectIntoShape(x: number, y: number, z: number, tile: [number, number, number], shape: VolumeShape): { x: number; y: number; z: number; inside: boolean } {
  let inside = true;
  const fold = (v: number, max: number) => {
    if (v < 0) {
      inside = false;
      return -v;
    }
    if (v > max) {
      inside = false;
      return 2 * max - v;
    }
    return v;
  };
  if (shape === "hex-prism") {
    // The hex prism sits in the lofted field's [-1,1] horizontal space the
    // same way volumeField.ts places it (flats facing +-x, apothem
    // HEX_APOTHEM): reflect across the most-violated side plane, a few times
    // for the corners.
    for (let iteration = 0; iteration < 3; iteration++) {
      const wx = (x / tile[0]) * 2 - 1;
      const wz = (z / tile[2]) * 2 - 1;
      let worst = 0;
      let worstSide = -1;
      for (let side = 0; side < 6; side++) {
        const angle = (side * Math.PI) / 3;
        const d = wx * Math.cos(angle) + wz * Math.sin(angle) - HEX_APOTHEM;
        if (d > worst) {
          worst = d;
          worstSide = side;
        }
      }
      if (worstSide < 0) break;
      inside = false;
      const angle = (worstSide * Math.PI) / 3;
      x = ((wx - 2 * worst * Math.cos(angle) + 1) / 2) * tile[0];
      z = ((wz - 2 * worst * Math.sin(angle) + 1) / 2) * tile[2];
    }
    x = Math.max(0, Math.min(tile[0], x));
    z = Math.max(0, Math.min(tile[2], z));
  } else {
    x = fold(x, tile[0]);
    z = fold(z, tile[2]);
  }
  y = fold(y, tile[1]);
  return { x, y, z, inside };
}

interface ExtendedGrid {
  foam: Float32Array;
  void: Float32Array;
  size: number;
  /** Index of the first node strictly inside the tile. */
  first: number;
  /** Node spacing in feet, per axis. */
  step: [number, number, number];
}

/** Resamples the lofted field onto the half-cell-offset grid described at
 * the top of this file, producing the foam field (f inside, -|f| mirrored
 * outside) and the void field (-f inside, the same mirrored outside). */
function buildExtendedGrid(field: Float32Array, resolution: number, tile: [number, number, number], shape: VolumeShape): ExtendedGrid {
  const n = resolution;
  const cells = n - 5; // the lofted tile spans nodes EDGE .. n-1-EDGE
  const first = 2;
  const size = cells + 4; // one outside node each side + the two outermost layers marching cubes never polygonizes
  const step: [number, number, number] = [tile[0] / cells, tile[1] / cells, tile[2] / cells];
  const foam = new Float32Array(size * size * size);
  const voidField = new Float32Array(size * size * size);

  for (let kz = 0; kz < size; kz++)
    for (let ky = 0; ky < size; ky++)
      for (let kx = 0; kx < size; kx++) {
        const X = (kx - first + 0.5) * step[0];
        const Y = (ky - first + 0.5) * step[1];
        const Z = (kz - first + 0.5) * step[2];
        const r = reflectIntoShape(X, Y, Z, tile, shape);
        const value = sampleNodes(field, n, EDGE + (r.x / tile[0]) * cells, EDGE + (r.y / tile[1]) * cells, EDGE + (r.z / tile[2]) * cells);
        const i = kz * size * size + ky * size + kx;
        if (r.inside) {
          foam[i] = value;
          voidField[i] = -value;
        } else {
          const outside = -Math.abs(value) - 1e-4;
          foam[i] = outside;
          voidField[i] = outside;
        }
      }
  return { foam, void: voidField, size, first, step };
}

function marchGrid(values: Float32Array, grid: ExtendedGrid): THREE.BufferGeometry {
  const mc = new MarchingCubes(grid.size, new THREE.MeshBasicMaterial(), false, false, MAX_TRIANGLES);
  mc.isolation = 0;
  (mc.field as Float32Array).set(values);
  mc.update();

  const count: number = mc.count;
  const positions = (mc.positionArray as Float32Array).slice(0, count * 3);
  const normals = (mc.normalArray as Float32Array).slice(0, count * 3);

  // MarchingCubes emits [-1,1] local coordinates; node j sits at
  // (j - halfsize) / halfsize. Convert back to a (fractional) node index,
  // then to feet on the half-cell-offset grid (tile low corner = origin).
  const half = grid.size / 2;
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const node = positions[i * 3 + axis] * half + half;
      positions[i * 3 + axis] = (node - grid.first + 0.5) * grid.step[axis];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Builds the foam + void meshes (see the file header) for a lofted field.
 * `shape` decides what the void is carved out of: the full cube, or the hex
 * prism. Returns a Group ready to hand to GLTFExporter; the group carries
 * `userData.tileShape` so later renderers (the Boards outline, which wants
 * to trace the tile's outer shape) can tell a hex prism from a cube. */
export function buildTileScene(field: Float32Array, resolution: number, tileFt: [number, number, number] = SECTION_TILE_FT, shape: VolumeShape = "cube"): THREE.Group {
  const grid = buildExtendedGrid(field, resolution, tileFt, shape);
  const group = new THREE.Group();
  group.userData.tileShape = shape;

  // Double-sided: a lofted/blended field (unlike a Grasshopper erosion
  // export) can fold into thin, branching sheets rather than chunky solids,
  // and a single-sided material shows through to nothing on their backfaces.
  const foam = new THREE.Mesh(marchGrid(grid.foam, grid), new THREE.MeshStandardMaterial({ color: "#e8a6c8", side: THREE.DoubleSide }));
  foam.name = "foam";
  group.add(foam);

  const voidMesh = new THREE.Mesh(marchGrid(grid.void, grid), new THREE.MeshStandardMaterial({ color: "#1c1c1f", side: THREE.DoubleSide }));
  voidMesh.name = "void";
  group.add(voidMesh);

  return group;
}
