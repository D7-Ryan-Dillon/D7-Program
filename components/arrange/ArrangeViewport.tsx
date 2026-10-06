"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import type { ConnectorMade } from "@/lib/arrange/connectors";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { AutoRotateRig } from "@/lib/useAutoRotate";
import * as THREE from "three";
import { CaptureBridge } from "@/components/shared/CaptureBridge";
import type { ViewportHandle } from "@/lib/viewportCapture";
import type { ParsedTile } from "@/lib/types";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import { PLATE_COLOR, STRUT_COLOR } from "@/components/viewer/ThreeViewport";
import { markActive, publish, type CameraLink } from "@/lib/cameraLink";
import { fromScene, toScene, type PoseFt } from "@/lib/arrange/capture";
import { glbToFt, pieceMatrix } from "@/lib/arrange/placement";
import type { CompositeMeshes } from "@/lib/arrange/composite";
import type { EvidenceItem } from "@/lib/arrange/whole";
import type { Joint, Piece, Site, Vec3 } from "@/lib/arrange/types";

export { instanceMatrix } from "@/lib/arrange/legacyMatrix";

export type ViewportMode = "orbit" | "pan" | "box" | "measure" | "entrance";

/** What the parent can ask of the camera. */
export interface ViewportApi {
  setPose(pose: PoseFt): void;
  getPose(): PoseFt | null;
  /** Looks at a point from the current direction, at a distance that shows `radius` feet. */
  focus(center: Vec3, radius: number): void;
  fit(): void;
}

export interface ArrangeViewportProps {
  pieces: Piece[];
  tileById: Map<string, ParsedTile>;
  joints: Joint[];
  /** the stairs and ramps built into the pieces' floors (drawn as wedges when the smoothed model is not shown) */
  connectors?: ConnectorMade[];
  selected: Set<string>;
  highlight?: Set<string>;
  selectedJointId?: string | null;
  showJoints: boolean;
  visibility: MeshVisibility;
  colors: MeshColors;
  foamOpacity: number;
  /** show the combined, smoothed meshes instead of the separate pieces */
  composite?: CompositeMeshes | null;
  entrancePoint?: Vec3 | null;
  site?: Site;
  ghosts?: { piece: Piece; tile: ParsedTile }[];
  evidence?: EvidenceItem | null;
  measure?: Vec3[];
  /** cut the model at this height (ft) and look from above; null = whole */
  levelCut?: number | null;
  mode: ViewportMode;
  onPick(id: string | null, additive: boolean): void;
  onPickJoint?(id: string): void;
  onBoxSelect?(ids: string[], additive: boolean): void;
  onMeasurePoint?(p: Vec3): void;
  onEntrance?(id: string): void;
  /** drag a piece: raw horizontal offset (ft) from where the drag began; the parent snaps and previews it */
  onDragStart?(id: string): boolean;
  onDrag?(delta: Vec3, vertical: boolean): void;
  onDragEnd?(): void;
  fitKey?: number | string;
  link?: CameraLink;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  handleRef?: MutableRefObject<ViewportHandle | null>;
  apiRef?: MutableRefObject<ViewportApi | null>;
  /** scene centre / radius of the content (ft, Z up) for framing */
  frame?: { center: Vec3; radius: number } | null;
  /** hide these pieces (a build-up animation, "show only") */
  hidden?: Set<string>;
  /** which piece a point on the smoothed whole belongs to (so the fused model can still be picked and moved) */
  pieceAt?(p: Vec3): string | null;
  /** boxes drawn round the selected pieces (visible whatever the materials) */
  selectionBoxes?: { min: Vec3; max: Vec3 }[];
}

const JOINT_COLORS = { interlocks: "#e8a6c8", partial: "#db7228", poor: "#ff269e", sealed: "#8a8a8a" };
const jointColor = (j: Joint) => (j.score === null ? JOINT_COLORS.sealed : j.score >= 90 ? JOINT_COLORS.interlocks : j.score >= 60 ? JOINT_COLORS.partial : JOINT_COLORS.poor);

function material(color: string, visible: boolean, opacity: number, kind: "foam" | "void" | "plates" | "struts", emissive: string, intensity: number, clip: THREE.Plane[]) {
  const see = opacity < 1;
  return {
    visible,
    material: new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      transparent: see,
      opacity,
      depthWrite: !see,
      side: THREE.DoubleSide,
      emissive,
      emissiveIntensity: intensity,
      polygonOffset: true,
      polygonOffsetFactor: kind === "void" ? 2 : kind === "foam" ? 1 : kind === "plates" ? -2 : -3,
      polygonOffsetUnits: kind === "void" ? 2 : kind === "foam" ? 1 : kind === "plates" ? -2 : -3,
      clippingPlanes: clip,
    }),
  };
}

interface Look {
  visibility: MeshVisibility;
  colors: MeshColors;
  foamOpacity: number;
  clip: THREE.Plane[];
}

function styleScene(scene: THREE.Object3D, parts: THREE.Object3D | null, look: Look, emissive: string, intensity: number, ghost?: boolean) {
  const set = (mesh: THREE.Object3D | null | undefined, kind: "foam" | "void" | "plates" | "struts", color: string, visible: boolean, opacity: number) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const m = material(ghost ? "#e8a6c8" : color, visible, ghost ? 0.4 : opacity, kind, emissive, intensity, look.clip);
    mesh.visible = ghost ? kind === "foam" || kind === "plates" : m.visible;
    mesh.material = m.material;
    mesh.renderOrder = kind === "foam" ? 1 : 0;
  };
  set(scene.getObjectByName("foam"), "foam", look.colors.foam, look.visibility.foam, look.foamOpacity);
  set(scene.getObjectByName("void"), "void", look.colors.void, look.visibility.void, 1);
  if (parts) {
    set(parts.getObjectByName("plates"), "plates", look.colors.plates ?? PLATE_COLOR, look.visibility.plates ?? true, 1);
    set(parts.getObjectByName("struts"), "struts", look.colors.struts ?? STRUT_COLOR, look.visibility.struts ?? true, 1);
  }
}

// ---- one placed piece ----------------------------------------------------------------------------------------------

function PieceMesh({
  tile,
  piece,
  look,
  emphasis,
  ghost,
  onDown,
}: {
  tile: ParsedTile;
  piece: Piece;
  look: Look;
  emphasis: "none" | "selected" | "highlight";
  ghost?: boolean;
  onDown?: (e: ThreeEvent<PointerEvent>, id: string) => void;
}) {
  const gltf = useGLTF(tile.glbUrl);
  const partsGltf = useGLTF(tile.partsUrl ?? tile.glbUrl);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const parts = useMemo(() => (tile.partsUrl ? partsGltf.scene.clone(true) : null), [partsGltf, tile.partsUrl]);
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    styleScene(scene, parts, look, emphasis === "selected" ? "#c43383" : emphasis === "highlight" ? "#db7228" : "#000000", emphasis === "selected" ? 0.5 : emphasis === "highlight" ? 0.35 : 0, ghost);
  }, [scene, parts, look, emphasis, ghost]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.matrixAutoUpdate = false;
    g.matrix.copy(pieceMatrix(tile, piece));
    g.matrixWorldNeedsUpdate = true;
  }, [tile, piece]);

  return (
    <group ref={group} name={ghost ? undefined : `piece-${piece.id}`} userData={ghost ? { overlay: true } : { tileId: tile.id }} onPointerDown={ghost || !onDown ? undefined : (e) => onDown(e, piece.id)}>
      <primitive object={scene} raycast={ghost ? () => null : undefined} />
      {parts && <primitive object={parts} raycast={ghost ? () => null : undefined} />}
    </group>
  );
}

/** The combined smoothed meshes (engine glTF space, placed into feet through the same matrix as any engine tile). */
function CompositeView({ meshes, look, onDown }: { meshes: CompositeMeshes; look: Look; onDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  const group = useRef<THREE.Group>(null);
  const pseudo = useMemo(() => ({ schema: "erosion-tile/4", engineVersion: "arrange" }) as ParsedTile, []);
  useEffect(() => {
    styleScene(meshes.main, meshes.parts, look, "#000000", 0);
  }, [meshes, look]);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.matrixAutoUpdate = false;
    g.matrix.copy(glbToFt(pseudo));
    g.matrixWorldNeedsUpdate = true;
  }, [pseudo]);
  return (
    <group ref={group} onPointerDown={onDown}>
      <primitive object={meshes.main} />
      {meshes.parts && <primitive object={meshes.parts} />}
    </group>
  );
}

// ---- overlays ------------------------------------------------------------------------------------------------------

/** A stair or ramp built into a floor: a wedge from the doorway down to the room's floor. */
function ConnectorWedges({ connectors }: { connectors: ConnectorMade[] }) {
  const geos = useMemo(
    () =>
      connectors.map((c) => {
        const w = c.wedge;
        const P = (a: number, l: number, z: number): Vec3 => (w.axis === 0 ? [a, l, z] : [l, a, z]);
        const v = [P(w.from, w.l0, w.z0), P(w.from, w.l1, w.z0), P(w.from, w.l1, w.z1), P(w.from, w.l0, w.z1), P(w.to, w.l0, w.z0), P(w.to, w.l1, w.z0)];
        const idx = [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2, 0, 4, 5, 0, 5, 1];
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(v.flat(), 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      }),
    [connectors],
  );
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={connectors[i].jointId} geometry={g}>
          <meshStandardMaterial color="#db7228" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function JointPlates({ joints, selectedId, onPick }: { joints: Joint[]; selectedId?: string | null; onPick?: (id: string) => void }) {
  return (
    <>
      {joints.map((j) => {
        const sel = selectedId === j.id;
        // the plate is drawn exactly where the pieces touch: every patch of the joint, on notch and step walls as well as on box faces; a joint that
        // carries no walkable route is dimmer than one that does
        return j.patches.flatMap((p, pi) =>
          p.rects.map((r, ri) => {
            const size: Vec3 = [Math.max(r.max[0] - r.min[0], 0.35), Math.max(r.max[1] - r.min[1], 0.35), Math.max(r.max[2] - r.min[2], 0.35)];
            const c: Vec3 = [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2];
            return (
              <mesh
                key={`${j.id}-${pi}-${ri}`}
                position={c}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick?.(j.id);
                }}
              >
                <boxGeometry args={size} />
                <meshBasicMaterial color={jointColor(j)} transparent opacity={sel ? 0.95 : p.walkable ? 0.5 : 0.28} depthWrite={false} />
              </mesh>
            );
          }),
        );
      })}
    </>
  );
}

function SelectionBoxes({ boxes }: { boxes: { min: Vec3; max: Vec3 }[] }) {
  const geos = useMemo(() => boxes.map((b) => new THREE.EdgesGeometry(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))), [boxes]);
  return (
    <>
      {boxes.map((b, i) => (
        <lineSegments key={i} geometry={geos[i]} position={[(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]}>
          <lineBasicMaterial color="#e8a6c8" />
        </lineSegments>
      ))}
    </>
  );
}

function SiteBox({ site, z, height }: { site: Site; z: number; height: number }) {
  const pts = useMemo(() => {
    const [x0, y0] = site.min;
    const [x1, y1] = [site.min[0] + site.size[0], site.min[1] + site.size[1]];
    const ring = (zz: number): Vec3[] => [[x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz], [x0, y0, zz]];
    return { floor: ring(z), top: height > 0 ? ring(z + height) : null, posts: height > 0 ? ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][]) : [] };
  }, [site, z, height]);
  return (
    <>
      <Line points={pts.floor} color="#9a9a9a" lineWidth={1} dashed dashSize={2} gapSize={1.5} />
      {pts.top && <Line points={pts.top} color="#9a9a9a" lineWidth={1} dashed dashSize={2} gapSize={1.5} />}
      {pts.top && pts.posts.map(([x, y], i) => <Line key={i} points={[[x, y, z], [x, y, z + height]]} color="#6a6a6a" lineWidth={1} />)}
    </>
  );
}

function Evidence({ item }: { item: EvidenceItem }) {
  return (
    <>
      {item.polylines?.map((pts, i) => (pts.length > 1 ? <Line key={i} points={pts} color="#e8a6c8" lineWidth={3} /> : null))}
      {item.planes?.map((z, i) => (
        <mesh key={i} position={[0, 0, z]} visible>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial color="#e8a6c8" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {item.boxes?.map((b, i) => (
        <mesh key={i} position={[(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]}>
          <boxGeometry args={[b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]} />
          <meshBasicMaterial color="#ff269e" transparent opacity={0.22} depthWrite={false} wireframe={false} />
        </mesh>
      ))}
    </>
  );
}

function MeasureOverlay({ points }: { points: Vec3[] }) {
  if (!points.length) return null;
  const len = points.length === 2 ? Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]) : null;
  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial color="#db7228" />
        </mesh>
      ))}
      {points.length === 2 && <Line points={points} color="#db7228" lineWidth={2} />}
      <Html position={points[points.length - 1]} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
        <div className="whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] text-orange">
          {len !== null ? `${len.toFixed(1)} ft` : `z ${points[0][2].toFixed(1)} ft`}
        </div>
      </Html>
    </>
  );
}

// ---- interaction ---------------------------------------------------------------------------------------------------

interface DragState {
  id: string;
  plane: THREE.Plane;
  start: THREE.Vector3;
  vertical: boolean;
  moved: boolean;
}

/** Window-level pointer handling inside the canvas: dragging a piece over a horizontal (or, with Alt, a vertical) plane, and drawing a selection box. */
function Interaction({
  mode,
  controlsRef,
  dragRef,
  onDrag,
  onDragEnd,
  pieces,
  tileById,
  onBox,
  onBoxRect,
}: {
  mode: ViewportMode;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
  dragRef: MutableRefObject<DragState | null>;
  onDrag?: (delta: Vec3, vertical: boolean) => void;
  onDragEnd?: () => void;
  pieces: Piece[];
  tileById: Map<string, ParsedTile>;
  onBox?: (ids: string[], additive: boolean) => void;
  onBoxRect: (r: { x0: number; y0: number; x1: number; y1: number } | null) => void;
}) {
  const { gl, camera, raycaster, scene } = useThree();
  const boxStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        raycaster.setFromCamera(ndc(e), camera);
        const hit = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(d.plane, hit)) return;
        const a = fromScene(d.start);
        const b = fromScene(hit);
        const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        if (Math.hypot(delta[0], delta[1], delta[2]) > 0.4) d.moved = true;
        if (d.moved) onDrag?.(delta, d.vertical);
        return;
      }
      const s = boxStart.current;
      if (s) {
        const r = el.getBoundingClientRect();
        onBoxRect({ x0: s.x - r.left, y0: s.y - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        if (controlsRef.current) controlsRef.current.enabled = true;
        if (d.moved) onDragEnd?.();
        return;
      }
      const s = boxStart.current;
      if (s) {
        boxStart.current = null;
        onBoxRect(null);
        const r = el.getBoundingClientRect();
        const x0 = Math.min(s.x, e.clientX);
        const x1 = Math.max(s.x, e.clientX);
        const y0 = Math.min(s.y, e.clientY);
        const y1 = Math.max(s.y, e.clientY);
        if (controlsRef.current) controlsRef.current.enabled = true;
        if (x1 - x0 < 4 && y1 - y0 < 4) return;
        const ids: string[] = [];
        for (const p of pieces) {
          const t = tileById.get(p.tileId);
          if (!t) continue;
          const c = new THREE.Vector3(t.tileFt[0] / 2, t.tileFt[1] / 2, t.tileFt[2] / 2).applyMatrix4(pieceMatrix(t, p).clone().multiply(glbToFtInverse(t)));
          const v = toScene([c.x, c.y, c.z]).project(camera);
          const sx = ((v.x + 1) / 2) * r.width + r.left;
          const sy = ((1 - v.y) / 2) * r.height + r.top;
          if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(p.id);
        }
        onBox?.(ids, s.additive);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (mode !== "box" || e.button !== 0) return;
      boxStart.current = { x: e.clientX, y: e.clientY, additive: e.shiftKey };
      if (controlsRef.current) controlsRef.current.enabled = false;
    };
    // double-click sets the point the camera turns about (a large model is hard to orbit about its middle)
    const onDouble = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(scene.children, true).find((h) => {
        if (!h.object.visible) return false;
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.userData?.overlay) return false;
        return true;
      });
      const ctl = controlsRef.current;
      if (hit && ctl) {
        ctl.target.copy(hit.point);
        ctl.update();
      }
    };
    el.addEventListener("dblclick", onDouble);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("dblclick", onDouble);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, raycaster, scene, mode, controlsRef, dragRef, onDrag, onDragEnd, pieces, tileById, onBox, onBoxRect]);
  return null;
}

/** The inverse of a tile's glTF -> feet matrix (pieceMatrix includes it; the box centre is in tile feet). */
function glbToFtInverse(tile: ParsedTile): THREE.Matrix4 {
  return glbToFt(tile).clone().invert();
}

/** The camera, as the parent sees it. */
function ApiRig({ apiRef, controlsRef, fitRef }: { apiRef?: MutableRefObject<ViewportApi | null>; controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>; fitRef: MutableRefObject<(() => void) | null> }) {
  const { camera } = useThree();
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      setPose(pose) {
        const c = camera as THREE.PerspectiveCamera;
        c.position.copy(toScene(pose.pos));
        c.fov = pose.fov;
        c.near = Math.min(c.near, 0.1);
        c.updateProjectionMatrix();
        const ctl = controlsRef.current;
        if (ctl) {
          ctl.target.copy(toScene(pose.target));
          ctl.update();
        } else c.lookAt(toScene(pose.target));
      },
      getPose() {
        const ctl = controlsRef.current;
        const c = get().camera as THREE.PerspectiveCamera;
        if (!ctl) return null;
        return { pos: fromScene(c.position), target: fromScene(ctl.target), fov: c.fov };
      },
      focus(center, radius) {
        const ctl = controlsRef.current;
        if (!ctl) return;
        const t = toScene(center);
        const dir = camera.position.clone().sub(ctl.target).normalize();
        const dist = Math.max(radius * 3, 14);
        ctl.target.copy(t);
        camera.position.copy(t).addScaledVector(dir, dist);
        ctl.update();
      },
      fit: () => fitRef.current?.(),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera, controlsRef, get, fitRef]);
  return null;
}

/** Frames the content: when the first piece appears, and whenever `fitKey` changes or the parent asks. The camera keeps the direction it is looking from. (drei's <Bounds> measured the content before its matrices were set, so it framed it a few times too close.) */
function FitRig({ frame, fitKey, controlsRef, fitRef }: { frame: { center: Vec3; radius: number } | null; fitKey: number | string | undefined; controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>; fitRef: MutableRefObject<(() => void) | null> }) {
  const get = useThree((s) => s.get);
  const had = useRef(false);
  const doFit = useCallback(
    (fresh: boolean) => {
      if (!frame) return;
      const { camera, size } = get();
      const c = camera as THREE.PerspectiveCamera;
      const ctl = controlsRef.current;
      const target = toScene(frame.center);
      const dir = fresh || !ctl ? new THREE.Vector3(1, 0.85, 1) : c.position.clone().sub(ctl.target);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0.85, 1);
      dir.normalize();
      const vHalf = (c.fov * Math.PI) / 360;
      const hHalf = Math.atan(Math.tan(vHalf) * (size.width / Math.max(size.height, 1)));
      const dist = Math.max((frame.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.08, 20);
      c.position.copy(target).addScaledVector(dir, dist);
      c.near = Math.max(0.1, dist / 2500);
      c.far = dist * 40 + 4000;
      c.updateProjectionMatrix();
      if (ctl) {
        ctl.target.copy(target);
        ctl.update();
      } else c.lookAt(target);
    },
    [frame, get, controlsRef],
  );
  useEffect(() => {
    fitRef.current = () => doFit(false);
    return () => {
      fitRef.current = null;
    };
  }, [doFit, fitRef]);
  // the first time there is something to look at
  useEffect(() => {
    if (frame && !had.current) {
      had.current = true;
      doFit(true);
    }
    if (!frame) had.current = false;
  }, [frame, doFit]);
  // an explicit refit (generate, open, Fit)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    doFit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function LinkRig({ link, controlsRef, center, autoRotate, idleRef }: { link: CameraLink; controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>; center: THREE.Vector3; autoRotate: boolean; idleRef: MutableRefObject<boolean> }) {
  const camera = useThree((s) => s.camera);
  const interacting = useRef(false);
  const seen = useRef(-1);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const start = () => (interacting.current = true);
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
    controls.autoRotate = autoRotate && link.leader && !otherDriving && idleRef.current && !interacting.current;
    const drive = interacting.current || controls.autoRotate || (hub.driver === link.id && now - hub.lastActive < 700);
    if (drive) {
      if (controls.autoRotate) markActive(hub, link.id, now);
      seen.current = publish(hub, [camera.position.x - center.x, camera.position.y - center.y, camera.position.z - center.z], [controls.target.x - center.x, controls.target.y - center.y, controls.target.z - center.z], [camera.up.x, camera.up.y, camera.up.z]);
    } else if (seen.current !== hub.version) {
      seen.current = hub.version;
      camera.position.set(center.x + hub.pos[0], center.y + hub.pos[1], center.z + hub.pos[2]);
      camera.up.set(...hub.up);
      controls.target.set(center.x + hub.target[0], center.y + hub.target[1], center.z + hub.target[2]);
      controls.update();
    }
  });
  return null;
}

// ---- the viewport --------------------------------------------------------------------------------------------------

export function ArrangeViewport(props: ArrangeViewportProps) {
  const { pieces, tileById, joints, selected, highlight, selectedJointId, showJoints, visibility, colors, foamOpacity, composite, entrancePoint, site, ghosts, evidence, measure, levelCut, mode, hidden } = props;
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const idleRef = useRef(true);
  const fallbackHandle = useRef<ViewportHandle | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // every tile's meshes are fetched ahead of time, so a new arrangement appears whole instead of piece by piece
  useEffect(() => {
    for (const t of tileById.values()) {
      useGLTF.preload(t.glbUrl);
      if (t.partsUrl) useGLTF.preload(t.partsUrl);
    }
  }, [tileById]);
  // left-drag pans while the Pan tool is on, Space is held or Shift is held; right and middle drag always pan
  const modeRef = useRef(mode);
  const space = useRef(false);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === " " && !typing(e.target)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") space.current = false;
    };
    const pointer = (e: PointerEvent) => {
      const c = controlsRef.current;
      if (c) c.mouseButtons.LEFT = e.shiftKey || space.current || modeRef.current === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", pointer, { capture: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", pointer, { capture: true });
    };
  }, []);

  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), levelCut ?? 0), [levelCut]);
  const look = useMemo<Look>(() => ({ visibility, colors, foamOpacity, clip: levelCut === null || levelCut === undefined ? [] : [clip] }), [visibility, colors, foamOpacity, clip, levelCut]);

  const frame = props.frame ?? null;
  const center = useMemo(() => (frame ? toScene(frame.center) : new THREE.Vector3()), [frame]);
  const framing = useCallback(() => (frame ? { center: toScene(frame.center), radius: frame.radius } : null), [frame]);

  const onDown = useCallback(
    (e: ThreeEvent<PointerEvent>, id: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (mode === "measure") {
        props.onMeasurePoint?.(fromScene(e.point));
        return;
      }
      if (mode === "entrance") {
        props.onEntrance?.(id);
        return;
      }
      if (mode === "box" || mode === "pan") return;
      props.onPick(id, e.shiftKey || e.ctrlKey || e.metaKey);
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (props.onDragStart?.(id)) {
        const alt = e.altKey;
        const normal = alt ? new THREE.Vector3(e.camera.position.x - e.point.x, 0, e.camera.position.z - e.point.z).normalize() : new THREE.Vector3(0, 1, 0);
        dragRef.current = { id, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, e.point), start: e.point.clone(), vertical: alt, moved: false };
        if (controlsRef.current) controlsRef.current.enabled = false;
      }
    },
    [mode, props],
  );

  const groundZ = useMemo(() => {
    let z = Infinity;
    for (const p of pieces) z = Math.min(z, p.pos[2]);
    return Number.isFinite(z) ? z : 0;
  }, [pieces]);

  const visiblePieces = hidden ? pieces.filter((p) => !hidden.has(p.id)) : pieces;
  const cursor = mode === "measure" || mode === "entrance" || mode === "box" ? "crosshair" : mode === "pan" ? "grab" : "default";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40" style={{ cursor }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 42, near: 0.1, far: 4000, position: [60, 50, 60] }}
        gl={{ antialias: true, stencil: true }}
        onCreated={(s) => {
          s.gl.localClippingEnabled = true;
        }}
        onPointerMissed={() => {
          if (mode === "orbit") props.onPick(null, false);
        }}
      >
        <color attach="background" args={["#000000"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[40, 70, 30]} intensity={1.1} />
        <directionalLight position={[-30, -20, -40]} intensity={0.25} />
        <Suspense fallback={null}>
          <>
            <group rotation={[-Math.PI / 2, 0, 0]} name="arrangement">
              {composite ? (
                <CompositeView
                  meshes={composite}
                  look={look}
                  onDown={(e) => {
                    const id = props.pieceAt?.(fromScene(e.point));
                    if (id) onDown(e, id);
                  }}
                />
              ) : (
                visiblePieces.map((p) => {
                  const tile = tileById.get(p.tileId);
                  if (!tile) return null;
                  return <PieceMesh key={p.id} tile={tile} piece={p} look={look} emphasis={selected.has(p.id) ? "selected" : highlight?.has(p.id) ? "highlight" : "none"} onDown={onDown} />;
                })
              )}
              {ghosts?.map((g, i) => <PieceMesh key={`ghost-${i}`} tile={g.tile} piece={g.piece} look={look} emphasis="none" ghost />)}
              {props.selectionBoxes && props.selectionBoxes.length > 0 && (
                <group userData={{ overlay: true }}>
                  <SelectionBoxes boxes={props.selectionBoxes} />
                </group>
              )}
              {!!props.connectors?.length && !composite && (
                <group userData={{ overlay: true }}>
                  <ConnectorWedges connectors={props.connectors} />
                </group>
              )}
              {showJoints && !composite && (
                <group userData={{ overlay: true }}>
                  <JointPlates joints={joints} selectedId={selectedJointId} onPick={props.onPickJoint} />
                </group>
              )}
              {entrancePoint && (
                <group position={entrancePoint} userData={{ overlay: true }}>
                  <mesh>
                    <sphereGeometry args={[0.9, 16, 16]} />
                    <meshBasicMaterial color="#db7228" />
                  </mesh>
                  <mesh rotation={[0, 0, 0]}>
                    <ringGeometry args={[1.4, 1.8, 32]} />
                    <meshBasicMaterial color="#db7228" side={THREE.DoubleSide} transparent opacity={0.8} />
                  </mesh>
                </group>
              )}
              {site?.enabled && (
                <group userData={{ overlay: true }}>
                  <SiteBox site={site} z={groundZ} height={site.maxHeight} />
                </group>
              )}
              {evidence && (
                <group userData={{ overlay: true }}>
                  <Evidence item={evidence} />
                </group>
              )}
              {measure && (
                <group userData={{ overlay: true }}>
                  <MeasureOverlay points={measure} />
                </group>
              )}
            </group>
          </>
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} zoomToCursor screenSpacePanning panSpeed={1.4} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} autoRotate={false} />
        <AutoRotateRig controlsRef={controlsRef} enabled={!!props.autoRotate} secs={60 / Math.max(props.autoRotateSpeed ?? 2, 0.05)} manage={!props.link} idleRef={idleRef} />
        {props.link && <LinkRig link={props.link} controlsRef={controlsRef} center={center} autoRotate={!!props.autoRotate} idleRef={idleRef} />}
        <Interaction mode={mode} controlsRef={controlsRef} dragRef={dragRef} onDrag={props.onDrag} onDragEnd={props.onDragEnd} pieces={pieces} tileById={tileById} onBox={props.onBoxSelect} onBoxRect={setRect} />
        <ApiRig apiRef={props.apiRef} controlsRef={controlsRef} fitRef={fitRef} />
        <FitRig frame={frame} fitKey={props.fitKey} controlsRef={controlsRef} fitRef={fitRef} />
        <CaptureBridge handleRef={props.handleRef ?? fallbackHandle} framing={framing} />
      </Canvas>
      {rect && <div className="pointer-events-none absolute border border-magenta bg-magenta/10" style={{ left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) }} />}
    </div>
  );
}

