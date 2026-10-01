// Extracts a watertight-ish triangle mesh from a thresholded voxel channel
// via marching cubes, reusing three.js's own implementation (meant for live
// metaball demos, but perfectly usable offline as a plain isosurface
// extractor -- it just needs its `.field` filled and `.update()` called
// once). Used to build both the foam and void meshes a converted
// Section-Field tile needs, the same way a Grasshopper tile's GLB has both.

import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { SECTION_GRID, SECTION_TILE_FT } from "./voxelize";

const MAX_POLY_COUNT = 65536;

/** Runs marching cubes on one voxel channel (material or void-smooth, both
 * 0..255, isosurface at the midpoint -- see voxelize.ts) and returns a
 * BufferGeometry in real tile feet, origin at the tile's low corner,
 * matching every other tile's coordinate convention. `channel` must be
 * laid out exactly like TileVoxels (C order, z fastest -- HANDOFF section
 * 5), the same array voxelize.ts produces. */
export function marchChannel(channel: Uint8Array, grid: [number, number, number] = SECTION_GRID, tileFt: [number, number, number] = SECTION_TILE_FT): THREE.BufferGeometry {
  const [nx, ny, nz] = grid;
  if (nx !== ny || ny !== nz) {
    throw new Error("marchChannel requires a cubic grid (three.js's MarchingCubes addon assumes equal resolution on every axis)");
  }
  const resolution = nx;

  const mc = new MarchingCubes(resolution, new THREE.MeshBasicMaterial(), false, false, MAX_POLY_COUNT);
  mc.isolation = 127.5;

  // Our own voxel order is (x*ny + y)*nz + z; MarchingCubes' own is
  // size2*z + size*y + x. Both are indexing the exact same resolution^3
  // grid, so this is a pure index permutation, not a resample.
  const size = mc.size as number;
  const size2 = mc.size2 as number;
  const field: Float32Array = mc.field;
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        field[size2 * z + size * y + x] = channel[(x * ny + y) * nz + z];
      }
    }
  }

  mc.update();

  const count: number = mc.count;
  const positions = (mc.positionArray as Float32Array).slice(0, count * 3);
  const normals = (mc.normalArray as Float32Array).slice(0, count * 3);

  // MarchingCubes emits positions in its own [-1,1]^3 local space; this
  // tile's own convention is feet, origin at the low corner, so a local
  // coordinate of -1 is 0 ft and +1 is tileFt on that axis.
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = ((positions[i * 3 + 0] + 1) / 2) * tileFt[0];
    positions[i * 3 + 1] = ((positions[i * 3 + 1] + 1) / 2) * tileFt[1];
    positions[i * 3 + 2] = ((positions[i * 3 + 2] + 1) / 2) * tileFt[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Builds the foam + void meshes for a converted tile, named exactly like a
 * Grasshopper tile's GLB nodes (see components/viewer/ThreeViewport.tsx's
 * `getObjectByName("foam"/"void")`), from the material/void-smooth channels
 * voxelize.ts produces. Returns a Group ready to hand to GLTFExporter. */
export function buildTileScene(material: Uint8Array, voidSmooth: Uint8Array, grid: [number, number, number] = SECTION_GRID, tileFt: [number, number, number] = SECTION_TILE_FT): THREE.Group {
  const group = new THREE.Group();

  // Double-sided: a lofted/blended field (unlike a Grasshopper erosion
  // export) can fold into thin, branching sheets rather than chunky solids,
  // and a single-sided material shows through to nothing on their backfaces.
  const foam = new THREE.Mesh(marchChannel(material, grid, tileFt), new THREE.MeshStandardMaterial({ color: "#e8a6c8", side: THREE.DoubleSide }));
  foam.name = "foam";
  group.add(foam);

  const voidMesh = new THREE.Mesh(marchChannel(voidSmooth, grid, tileFt), new THREE.MeshStandardMaterial({ color: "#1c1c1f", side: THREE.DoubleSide }));
  voidMesh.name = "void";
  group.add(voidMesh);

  return group;
}
