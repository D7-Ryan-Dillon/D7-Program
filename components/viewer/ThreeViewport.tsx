"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import { ALL_VIEWS, AXO_VIEWS } from "@/lib/faceViews";
import { useShiftToPan } from "@/lib/useShiftToPan";
import { CaptureBridge } from "@/components/shared/CaptureBridge";
import type { ViewportHandle } from "@/lib/viewportCapture";
import { markActive, publish, type CameraLink } from "@/lib/cameraLink";
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
/** 0-1 per mesh; only used in rendered mode (ghosted keeps its own fixed look). */
export interface MeshOpacity {
  foam: number;
  void: number;
}

interface Bounds {
  center: THREE.Vector3;
  radius: number;
}

const FULL_OPACITY: MeshOpacity = { foam: 1, void: 1 };
const DEFAULT_BOUNDS: Bounds = { center: new THREE.Vector3(0, 0, 0), radius: 5 };

interface ModelProps {
  tile: ParsedTile;
  displayMode: DisplayMode;
  visibility: MeshVisibility;
  colors: MeshColors;
  opacity: MeshOpacity;
  clip?: ClipState;
  onBounds: (bounds: Bounds) => void;
}

function applyMaterial(mesh: THREE.Mesh, color: string, visible: boolean, ghosted: boolean, kind: "foam" | "void", opacity: number) {
  mesh.visible = visible;
  const alpha = ghosted ? 0.22 : opacity;
  const see = ghosted || opacity < 1;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    transparent: see,
    opacity: alpha,
    depthWrite: !see,
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

function Model({ tile, displayMode, visibility, colors, opacity, clip, onBounds }: ModelProps) {
  const gltf = useGLTF(tile.glbUrl);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const clipExtrasRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    const foam = scene.getObjectByName("foam");
    const voidMesh = scene.getObjectByName("void");
    if (foam instanceof THREE.Mesh) applyMaterial(foam, colors.foam, visibility.foam, displayMode === "ghosted", "foam", opacity.foam);
    if (voidMesh instanceof THREE.Mesh) applyMaterial(voidMesh, colors.void, visibility.void, displayMode === "ghosted", "void", opacity.void);
  }, [scene, displayMode, visibility, colors, opacity]);

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
  nonce,
}: {
  activeViewKey: string;
  bounds: Bounds;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
  nonce: number;
}) {
  const { camera } = useThree();
  // Read when a view is chosen (not a dependency): resizing the pane must not throw away the camera you orbited to.
  const get = useThree((s) => s.get);
  const target = useRef({ pos: new THREE.Vector3(8, 6, 8), up: new THREE.Vector3(0, 1, 0) });
  const animating = useRef(true);

  useEffect(() => {
    const preset = ALL_VIEWS.find((v) => v.key === activeViewKey) ?? AXO_VIEWS.find((v) => v.key === activeViewKey) ?? ALL_VIEWS[ALL_VIEWS.length - 1];
    // Far enough that the whole model fits whichever of the two field-of-view
    // angles is tighter -- a narrow pane (multi-viewer) is limited by its width.
    const { size } = get();
    const vHalf = (((camera as THREE.PerspectiveCamera).fov ?? 42) * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (size.width / Math.max(size.height, 1)));
    const distance = Math.max((bounds.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.93, 1);
    const dir = new THREE.Vector3(...preset.dir).normalize();
    target.current.pos.copy(bounds.center).addScaledVector(dir, distance);
    target.current.up.set(...preset.up);
    animating.current = true;
  }, [activeViewKey, bounds, nonce, camera, get]);

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

/** Keeps this viewport's camera in step with the others sharing a LinkHub
 * (lib/cameraLink.ts): writes its own while it is being orbited (or while the
 * leader auto-rotates), copies the hub's otherwise. */
function LinkRig({ link, controlsRef, bounds, autoRotate }: { link: CameraLink; controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>; bounds: Bounds; autoRotate: boolean }) {
  const camera = useThree((s) => s.camera);
  const interacting = useRef(false);
  const seen = useRef(-1);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const start = () => {
      interacting.current = true;
    };
    const end = () => {
      interacting.current = false;
      markActive(link.hub, link.id, performance.now());
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
    };
  }, [controlsRef, link]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const hub = link.hub;
    const now = performance.now();
    if (interacting.current) markActive(hub, link.id, now);
    const otherDriving = hub.driver !== null && hub.driver !== link.id && now - hub.lastActive < 700;
    controls.autoRotate = autoRotate && link.leader && !otherDriving;
    const iDrive = interacting.current || controls.autoRotate || (hub.driver === link.id && now - hub.lastActive < 700);
    const c = bounds.center;
    if (iDrive) {
      if (controls.autoRotate) markActive(hub, link.id, now);
      seen.current = publish(
        hub,
        [camera.position.x - c.x, camera.position.y - c.y, camera.position.z - c.z],
        [controls.target.x - c.x, controls.target.y - c.y, controls.target.z - c.z],
        [camera.up.x, camera.up.y, camera.up.z],
      );
    } else if (seen.current !== hub.version) {
      seen.current = hub.version;
      camera.position.set(c.x + hub.pos[0], c.y + hub.pos[1], c.z + hub.pos[2]);
      camera.up.set(...hub.up);
      controls.target.set(c.x + hub.target[0], c.y + hub.target[1], c.z + hub.target[2]);
      controls.update();
    }
  });
  return null;
}

export function ThreeViewport({
  tile,
  displayMode,
  visibility,
  colors,
  opacity = FULL_OPACITY,
  clip,
  activeViewKey,
  autoRotate = false,
  autoRotateSpeed = 2,
  viewNonce = 0,
  handleRef,
  link,
}: {
  tile: ParsedTile;
  displayMode: DisplayMode;
  visibility: MeshVisibility;
  colors: MeshColors;
  opacity?: MeshOpacity;
  clip?: ClipState;
  activeViewKey: string;
  /** Slowly orbits the model about its vertical axis (the user can still take over). */
  autoRotate?: boolean;
  /** OrbitControls units: 2 = one turn per 30 s at 60 fps. */
  autoRotateSpeed?: number;
  /** Bump to snap the camera back to `activeViewKey`. */
  viewNonce?: number;
  /** Receives what an offscreen PNG / turntable export needs. */
  handleRef?: MutableRefObject<ViewportHandle | null>;
  /** Shares this camera with other viewports (match cameras). */
  link?: CameraLink;
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  useShiftToPan(controlsRef);
  const fallbackHandle = useRef<ViewportHandle | null>(null);
  const framing = useCallback(() => ({ center: bounds.center.clone(), radius: bounds.radius }), [bounds]);

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
          <Model tile={tile} displayMode={displayMode} visibility={visibility} colors={colors} opacity={opacity} clip={clip ?? defaultClipState()} onBounds={setBounds} />
          <ErrorBoundary>
            <Environment preset="city" environmentIntensity={0.25} />
          </ErrorBoundary>
        </Suspense>
        <CameraRig activeViewKey={activeViewKey} bounds={bounds} controlsRef={controlsRef} nonce={viewNonce} />
        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} autoRotate={link ? false : autoRotate} autoRotateSpeed={autoRotateSpeed} />
        {link && <LinkRig link={link} controlsRef={controlsRef} bounds={bounds} autoRotate={autoRotate} />}
        <CaptureBridge handleRef={handleRef ?? fallbackHandle} framing={framing} />
      </Canvas>
    </div>
  );
}
