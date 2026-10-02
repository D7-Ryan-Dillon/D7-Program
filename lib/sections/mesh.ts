// Extracts a watertight-ish triangle mesh from a thresholded voxel channel
// via marching cubes, reusing three.js's own implementation (meant for live
// metaball demos, but perfectly usable offline as a plain isosurface
// extractor -- it just needs its `.field` filled and `.update()` called
// once). Used to build both the foam and void meshes a converted
// Section-Field tile needs, the same way a Grasshopper tile's GLB has both.

import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { SECTION_GRID, SECTION_TILE_FT } from "./voxelize";

const MAX_POLY_COUNT = 180000;

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

/** Runs marching cubes directly on the raw signed field volumeField.ts
 * builds (resolution 46 by default, +-1, with a 2-cell forced-void margin
 * baked into its own boundary -- see volumeField.ts's buildVolumeField).
 * This is the same resolution the field is lofted at, with no intermediate
 * resample: three.js's MarchingCubes addon never polygonizes the outermost
 * field layer or two (it was built for metaballs that never reach the
 * field's edge), so meshing straight from a resampled, unpadded 40-grid
 * left real face-traced material right at that silently-dropped edge,
 * producing an open/uncapped mesh. Meshing the native field instead keeps
 * the real data safely inside the margin, exactly like the original
 * Section-Field tool this was ported from.
 * `isolation = 0` matches the field's own sign convention (+ = material,
 * 0 = surface) rather than the 0..255 remap marchChannel's callers use.
 * The `resolution/(resolution-4)` factor undoes the margin's shrink of the
 * usable [0,1]^3 space, baked directly into the emitted vertex positions
 * (not a node-level Object3D.scale) so every consumer that reads raw
 * geometry -- GLTFExporter, the OBJ exporter, csgFuse.ts -- keeps working
 * unmodified, with no separate transform to account for. */
export function marchSignedField(field: Float32Array, resolution: number, tileFt: [number, number, number] = SECTION_TILE_FT): THREE.BufferGeometry {
  const mc = new MarchingCubes(resolution, new THREE.MeshBasicMaterial(), false, false, MAX_POLY_COUNT);
  mc.isolation = 0;
  (mc.field as Float32Array).set(field);
  mc.update();

  const count: number = mc.count;
  const positions = (mc.positionArray as Float32Array).slice(0, count * 3);
  const normals = (mc.normalArray as Float32Array).slice(0, count * 3);

  const scaleFactor = resolution / (resolution - 4);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = ((positions[i * 3 + 0] * scaleFactor + 1) / 2) * tileFt[0];
    positions[i * 3 + 1] = ((positions[i * 3 + 1] * scaleFactor + 1) / 2) * tileFt[1];
    positions[i * 3 + 2] = ((positions[i * 3 + 2] * scaleFactor + 1) / 2) * tileFt[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Builds the foam + void meshes for a converted tile, named exactly like a
 * Grasshopper tile's GLB nodes (see components/viewer/ThreeViewport.tsx's
 * `getObjectByName("foam"/"void")`), directly from the native-resolution
 * lofted field (see marchSignedField above) rather than the resampled 40^3
 * voxel channels voxelize.ts produces for scoring. The void mesh is the
 * same field negated -- its own isosurface at the complementary shape,
 * exactly mirroring how a Grasshopper tile's foam/void meshes are two
 * independent-but-complementary channels. Returns a Group ready to hand to
 * GLTFExporter. */
export function buildTileScene(field: Float32Array, resolution: number, tileFt: [number, number, number] = SECTION_TILE_FT): THREE.Group {
  const group = new THREE.Group();

  // Double-sided: a lofted/blended field (unlike a Grasshopper erosion
  // export) can fold into thin, branching sheets rather than chunky solids,
  // and a single-sided material shows through to nothing on their backfaces.
  const foam = new THREE.Mesh(marchSignedField(field, resolution, tileFt), new THREE.MeshStandardMaterial({ color: "#e8a6c8", side: THREE.DoubleSide }));
  foam.name = "foam";
  group.add(foam);

  const voidField = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) voidField[i] = -field[i];
  const voidMesh = new THREE.Mesh(marchSignedField(voidField, resolution, tileFt), new THREE.MeshStandardMaterial({ color: "#1c1c1f", side: THREE.DoubleSide }));
  voidMesh.name = "void";
  group.add(voidMesh);

  return group;
}
