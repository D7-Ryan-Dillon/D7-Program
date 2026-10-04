// The floor plates of a Builder tile as their own mesh (a second GLB with one node, "plates"), so the Viewer can colour
// them apart from the foam like it does for an engine tile. Marched from the same slab field applyPlates reports
// (plates.ts), on the same grid as the tile's own meshes, so they sit exactly inside the foam surface.

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildTileScene } from "./mesh";
import { SECTION_TILE_FT } from "./voxelize";
import type { VolumeShape } from "./volumeField";

/** An object URL for the plates GLB, or undefined when the plate field encloses nothing. */
export async function buildPlatesGlbUrl(plateField: Float32Array, resolution: number, shape: VolumeShape): Promise<string | undefined> {
  const scene = buildTileScene(plateField, resolution, SECTION_TILE_FT, shape);
  const mesh = scene.getObjectByName("foam");
  if (!(mesh instanceof THREE.Mesh) || !mesh.geometry.getAttribute("position")?.count) return undefined;
  mesh.name = "plates";
  const out = new THREE.Group();
  out.add(mesh);
  const glb = (await new GLTFExporter().parseAsync(out, { binary: true })) as ArrayBuffer;
  return URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
}
