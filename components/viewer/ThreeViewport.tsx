"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import { ALL_VIEWS } from "@/lib/faceViews";
import { useShiftToPan } from "@/lib/useShiftToPan";
import { applyClipToMesh, buildClipOutline, buildClipPlane, buildCutFaceCap, defaultClipState, type ClipState } from "@/lib/clipping";

export type DisplayMode = "rendered" | "ghosted";
export interface MeshVisibility {
  foam: boolean;
  void: boolean;
}
export interface MeshColors {
  foam: string;
  void: string;
}

interface Bounds {
  center: THREE.Vector3;
  radius: number;
}

const DEFAULT_BOUNDS: Bounds = { center: new THREE.Vector3(0, 0, 0), radius: 5 };

interface ModelProps {
  tile: ParsedTile;
  displayMode: DisplayMode;
  visibility: MeshVisibility;
  colors: MeshColors;
  clip?: ClipState;
  onBounds: (bounds: Bounds) => void;
}

function applyMaterial(mesh: THREE.Mesh, color: string, visible: boolean, ghosted: boolean, kind: "foam" | "void") {
  mesh.visible = visible;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    transparent: ghosted,
    opacity: ghosted ? 0.22 : 1,
    depthWrite: !ghosted,
    // Always double-sided: a lofted/branching mesh (Section-Field tiles)
    // isn't guaranteed as chunky-solid as a Grasshopper erosion export, so a
    // single-sided material can show through to empty backfaces. Matches
    // ArrangeViewport's own InstanceMesh, which never conditions this on
    // display mode either.
    side: THREE.DoubleSide,
    // Foam and void can share their whole interface surface (a builder tile's
    // void is the cube minus the foam); nudge the void behind so they don't z-fight.
    polygonOffset: true,
    polygonOffsetFactor: kind === "void" ? 2 : 1,
    polygonOffsetUnits: kind === "void" ? 2 : 1,
  });
}

function Model({ tile, displayMode, visibility, colors, clip, onBounds }: ModelProps) {
  const gltf = useGLTF(tile.glbUrl);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const clipExtrasRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    const foam = scene.getObjectByName("foam");
    const voidMesh = scene.getObjectByName("void");
    if (foam instanceof THREE.Mesh) applyMaterial(foam, colors.foam, visibility.foam, displayMode === "ghosted", "foam");
    if (voidMesh instanceof THREE.Mesh) applyMaterial(voidMesh, colors.void, visibility.void, displayMode === "ghosted", "void");
  }, [scene, displayMode, visibility, colors]);

  useEffect(() => {
    for (const obj of clipExtrasRef.current) {
      obj.removeFromParent();
    }
    clipExtrasRef.current = [];

    const foam = scene.getObjectByName("foam");
    const voidMesh = scene.getObjectByName("void");
    const meshes = [foam, voidMesh].filter((m): m is THREE.Mesh => m instanceof THREE.Mesh);

    if (!clip?.enabled) {
      for (const mesh of meshes) applyClipToMesh(mesh, null);
      return;
    }

    const box = new THREE.Box3().setFromObject(scene);
    const plane = buildClipPlane(clip, box);
    for (const mesh of meshes) applyClipToMesh(mesh, plane);

    const outline = buildClipOutline(clip, box);
    scene.add(outline);
    clipExtrasRef.current.push(outline);

    if (clip.cutFace?.enabled) {
      if (foam instanceof THREE.Mesh) {
        const cap = buildCutFaceCap(foam, plane, box, clip, clip.cutFace.foamColor, clip.cutFace.foamOpacity);
        scene.add(cap);
        clipExtrasRef.current.push(cap);
      }
      if (voidMesh instanceof THREE.Mesh) {
        const cap = buildCutFaceCap(voidMesh, plane, box, clip, clip.cutFace.voidColor, clip.cutFace.voidOpacity);
        scene.add(cap);
        clipExtrasRef.current.push(cap);
      }
    }
  }, [scene, clip]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
      onBounds({ center: sphere.center.clone(), radius: sphere.radius });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  return <primitive object={scene} />;
}

function CameraRig({
  activeViewKey,
  bounds,
  controlsRef,
}: {
  activeViewKey: string;
  bounds: Bounds;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const { camera } = useThree();
  const target = useRef({ pos: new THREE.Vector3(8, 6, 8), up: new THREE.Vector3(0, 1, 0) });
  const animating = useRef(true);

  useEffect(() => {
    const preset = ALL_VIEWS.find((v) => v.key === activeViewKey) ?? ALL_VIEWS[ALL_VIEWS.length - 1];
    const distance = Math.max(bounds.radius * 2.6, 1);
    const dir = new THREE.Vector3(...preset.dir).normalize();
    target.current.pos.copy(bounds.center).addScaledVector(dir, distance);
    target.current.up.set(...preset.up);
    animating.current = true;
  }, [activeViewKey, bounds]);

  useFrame(() => {
    if (!animating.current) return;
    camera.position.lerp(target.current.pos, 0.18);
    camera.up.lerp(target.current.up, 0.18);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerp(bounds.center, 0.18);
      controls.update();
    } else {
      camera.lookAt(bounds.center);
    }
    if (camera.position.distanceTo(target.current.pos) < 0.01) {
      animating.current = false;
    }
  });

  return null;
}

export function ThreeViewport({
  tile,
  displayMode,
  visibility,
  colors,
  clip,
  activeViewKey,
}: {
  tile: ParsedTile;
  displayMode: DisplayMode;
  visibility: MeshVisibility;
  colors: MeshColors;
  clip?: ClipState;
  activeViewKey: string;
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  useShiftToPan(controlsRef);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 42, near: 0.05, far: 500, position: [8, 6, 8] }}
        gl={{ antialias: true, stencil: true }}
        onCreated={(state) => {
          state.gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={["#0a0a0b"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1.1} />
        <directionalLight position={[-6, -4, -6]} intensity={0.25} />
        <Suspense fallback={null}>
          <Model tile={tile} displayMode={displayMode} visibility={visibility} colors={colors} clip={clip ?? defaultClipState()} onBounds={setBounds} />
          <ErrorBoundary>
            <Environment preset="city" environmentIntensity={0.25} />
          </ErrorBoundary>
        </Suspense>
        <CameraRig activeViewKey={activeViewKey} bounds={bounds} controlsRef={controlsRef} />
        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  );
}
