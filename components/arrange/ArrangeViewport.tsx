"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "@/lib/arrange/types";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";

// Verified against a real export's glTF extras: to_tile_ft_row_major gives
// x_ft = 3.280839895013123 * x_m, y_ft = -.. * z_m, z_ft = .. * y_m (feet,
// Z-up <-> metres, Y-up). We invert it here to place instances by feet.
const FEET_PER_METRE = 3.280839895013123;
export function ftToGlb(v: [number, number, number]): [number, number, number] {
  const s = 1 / FEET_PER_METRE;
  return [v[0] * s, v[2] * s, -v[1] * s];
}

/**
 * Mirror letters (x/y/z, Rhino/feet convention) then a quarter-turn rotation
 * about the vertical axis (HANDOFF section 5), both pivoting on the tile's
 * own centre, then a world placement offset -- all converted into the GLB's
 * metres/Y-up space. Rhino's +Z (vertical) rotation is GLB's +Y rotation;
 * a Rhino y-mirror lands on GLB's z axis because y_ft = -3.28... * z_m.
 */
export function instanceMatrix(tileFt: [number, number, number], mirror: string, rot: number, pos: [number, number, number]): THREE.Matrix4 {
  const center = ftToGlb([tileFt[0] / 2, tileFt[1] / 2, tileFt[2] / 2]);
  let sx = 1, sy = 1, sz = 1;
  for (const ch of mirror.toLowerCase()) {
    if (ch === "x") sx = -1;
    else if (ch === "y") sz = -1;
    else if (ch === "z") sy = -1;
  }
  const worldOffset = ftToGlb([pos[0] * tileFt[0], pos[1] * tileFt[1], pos[2] * tileFt[2]]);

  const toOrigin = new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]);
  const backFromOrigin = new THREE.Matrix4().makeTranslation(center[0], center[1], center[2]);
  const mirrorM = new THREE.Matrix4().makeScale(sx, sy, sz);
  const rotM = new THREE.Matrix4().makeRotationY((((rot % 4) + 4) % 4) * (Math.PI / 2));
  const worldM = new THREE.Matrix4().makeTranslation(worldOffset[0], worldOffset[1], worldOffset[2]);

  return new THREE.Matrix4().multiply(worldM).multiply(backFromOrigin).multiply(rotM).multiply(mirrorM).multiply(toOrigin);
}

function InstanceMesh({
  tile,
  instance,
  visibility,
  colors,
}: {
  tile: ParsedTile;
  instance: PlacedInstance;
  visibility: MeshVisibility;
  colors: MeshColors;
}) {
  const gltf = useGLTF(tile.glbUrl);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const setup = (mesh: THREE.Object3D | null, color: string, visible: boolean) => {
      if (mesh instanceof THREE.Mesh) {
        mesh.visible = visible;
        mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
      }
    };
    setup(scene.getObjectByName("foam") ?? null, colors.foam, visibility.foam);
    setup(scene.getObjectByName("void") ?? null, colors.void, visibility.void);
  }, [scene, colors, visibility]);

  useEffect(() => {
    const m = instanceMatrix(tile.tileFt, instance.mirror, instance.rot, instance.pos);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    const g = groupRef.current;
    if (g) {
      g.position.copy(p);
      g.quaternion.copy(q);
      g.scale.copy(s);
    }
  }, [tile, instance]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function FusedMesh({ mesh }: { mesh: THREE.Mesh }) {
  return <primitive object={mesh} />;
}

export function ArrangeViewport({
  instances,
  tileById,
  visibility,
  colors,
  fusedMesh,
}: {
  instances: PlacedInstance[];
  tileById: Map<string, ParsedTile>;
  visibility: MeshVisibility;
  colors: MeshColors;
  fusedMesh?: THREE.Mesh | null;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
      <Canvas dpr={[1, 2]} camera={{ fov: 45, near: 0.05, far: 1000, position: [15, 12, 15] }} gl={{ antialias: true }}>
        <color attach="background" args={["#0a0a0b"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 16, 8]} intensity={1.1} />
        <directionalLight position={[-8, -6, -8]} intensity={0.25} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.3}>
            {fusedMesh ? (
              <FusedMesh mesh={fusedMesh} />
            ) : (
              instances.map((inst) => {
                const tile = tileById.get(inst.tileId);
                if (!tile) return null;
                return <InstanceMesh key={inst.id} tile={tile} instance={inst} visibility={visibility} colors={colors} />;
              })
            )}
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  );
}
