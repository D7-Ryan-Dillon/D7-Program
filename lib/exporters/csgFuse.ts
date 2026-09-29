import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";
import { instanceMatrix } from "@/components/arrange/ArrangeViewport";
import type { ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "@/lib/arrange/types";

const loader = new GLTFLoader();

/** The engine's marching-cubes export only writes position + normal (no UVs) -- three-bvh-csg's
 * Evaluator expects a uv attribute to exist on every brush and throws reading it otherwise. */
function ensureUv(geometry: THREE.BufferGeometry) {
  if (geometry.attributes.uv) return geometry;
  const count = geometry.attributes.position.count;
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  return geometry;
}

/** Real boolean union (three-bvh-csg), not a hand-rolled approximation. meshNames picks which
 * of "foam" / "void" to fuse -- pass both to seal the whole solid, or just one to read space through it. */
export async function fuseAssembly(
  instances: PlacedInstance[],
  tileById: Map<string, ParsedTile>,
  meshNames: ("foam" | "void")[],
): Promise<THREE.Mesh> {
  const evaluator = new Evaluator();
  let result: Brush | null = null;

  for (const inst of instances) {
    const tile = tileById.get(inst.tileId);
    if (!tile) continue;
    const gltf = await loader.loadAsync(tile.glbUrl);
    const m = instanceMatrix(tile.tileFt, inst.mirror, inst.rot, inst.pos);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);

    for (const name of meshNames) {
      const mesh = gltf.scene.getObjectByName(name);
      if (!(mesh instanceof THREE.Mesh)) continue;
      const brush = new Brush(ensureUv(mesh.geometry.clone()));
      brush.position.copy(p);
      brush.quaternion.copy(q);
      brush.scale.copy(s);
      brush.updateMatrixWorld(true);
      result = result ? (evaluator.evaluate(result, brush, ADDITION) as Brush) : brush;
    }
  }

  if (!result) throw new Error("Nothing to fuse — check that Foam or Void is visible.");
  result.geometry.computeVertexNormals();
  result.material = new THREE.MeshStandardMaterial({ color: "#e8a6c8", roughness: 0.85, side: THREE.DoubleSide });
  return result;
}
