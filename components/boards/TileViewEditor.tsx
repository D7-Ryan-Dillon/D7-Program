"use client";

import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "@/components/boards/ColorField";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { ClippingPlaneControl } from "@/components/shared/ClippingPlaneControl";
import { applyClipToMesh, buildClipOutline, buildClipPlane, buildCutFaceCap, defaultClipState, type ClipState } from "@/lib/clipping";
import { buildFacetLines, buildSilhouetteOutline } from "@/lib/renderTile";
import { POPUP_VIEW_PRESETS } from "@/lib/faceViews";
import type { BoardConfig, BoardSlot, BoardSlotOverrides, FacetLineSettings, OutlineSettings } from "@/lib/boards/types";
import type { ParsedTile } from "@/lib/types";

function applyMaterial(mesh: THREE.Object3D | null | undefined, color: string, opacity: number, visible: boolean) {
  if (!(mesh instanceof THREE.Mesh)) return;
  mesh.visible = visible;
  mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide });
}

function PopupModel({
  glbUrl,
  foamColor,
  voidColor,
  foamOpacity,
  voidOpacity,
  clip,
  foamOutline,
  voidOutline,
  foamFacetLines,
  voidFacetLines,
  onBounds,
}: {
  glbUrl: string;
  foamColor: string;
  voidColor: string;
  foamOpacity: number;
  voidOpacity: number;
  clip: ClipState;
  foamOutline: OutlineSettings;
  voidOutline: OutlineSettings;
  foamFacetLines: FacetLineSettings;
  voidFacetLines: FacetLineSettings;
  onBounds: (center: THREE.Vector3, radius: number) => void;
}) {
  const gltf = useGLTF(glbUrl);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const extrasRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    applyMaterial(scene.getObjectByName("foam"), foamColor, foamOpacity, true);
    applyMaterial(scene.getObjectByName("void"), voidColor, voidOpacity, true);
  }, [scene, foamColor, voidColor, foamOpacity, voidOpacity]);

  useEffect(() => {
    for (const obj of extrasRef.current) obj.removeFromParent();
    extrasRef.current = [];

    const foam = scene.getObjectByName("foam");
    const voidMesh = scene.getObjectByName("void");
    const box = new THREE.Box3().setFromObject(scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) onBounds(sphere.center.clone(), sphere.radius);

    const meshes = [foam, voidMesh].filter((m): m is THREE.Mesh => m instanceof THREE.Mesh);
    if (!clip.enabled) {
      for (const mesh of meshes) applyClipToMesh(mesh, null);
    } else {
      const plane = buildClipPlane(clip, box);
      for (const mesh of meshes) applyClipToMesh(mesh, plane);
      const outline = buildClipOutline(clip, box);
      scene.add(outline);
      extrasRef.current.push(outline);
      if (clip.cutFace?.enabled) {
        if (foam instanceof THREE.Mesh) {
          const cap = buildCutFaceCap(foam, plane, box, clip, clip.cutFace.foamColor, clip.cutFace.foamOpacity);
          scene.add(cap);
          extrasRef.current.push(cap);
        }
        if (voidMesh instanceof THREE.Mesh) {
          const cap = buildCutFaceCap(voidMesh, plane, box, clip, clip.cutFace.voidColor, clip.cutFace.voidOpacity);
          scene.add(cap);
          extrasRef.current.push(cap);
        }
      }
    }

    if (foam instanceof THREE.Mesh) {
      if (foamOutline.enabled) {
        const o = buildSilhouetteOutline(foam, foamOutline, sphere.radius || 1);
        scene.add(o);
        extrasRef.current.push(o);
      }
      if (foamFacetLines.enabled) {
        const f = buildFacetLines(foam, foamFacetLines);
        scene.add(f);
        extrasRef.current.push(f);
      }
    }
    if (voidMesh instanceof THREE.Mesh) {
      if (voidOutline.enabled) {
        const o = buildSilhouetteOutline(voidMesh, voidOutline, sphere.radius || 1);
        scene.add(o);
        extrasRef.current.push(o);
      }
      if (voidFacetLines.enabled) {
        const f = buildFacetLines(voidMesh, voidFacetLines);
        scene.add(f);
        extrasRef.current.push(f);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, clip, foamOutline, voidOutline, foamFacetLines, voidFacetLines]);

  return <primitive object={scene} />;
}

/** Locks the camera to a chosen axo/ortho preset (rotation/pan disabled on
 * OrbitControls by the caller, zoom still allowed) when `presetKey` isn't
 * "perspective"; does nothing in free Perspective mode, where OrbitControls
 * itself drives the camera. First use of a locked-camera mode anywhere in
 * this app -- the pattern otherwise mirrors ThreeViewport's own CameraRig. */
function AxoLockRig({
  presetKey,
  center,
  radius,
  controlsRef,
}: {
  presetKey: string;
  center: THREE.Vector3;
  radius: number;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const { camera } = useThree();
  const target = useRef({ pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) });
  const animating = useRef(true);

  useEffect(() => {
    if (presetKey === "perspective") return;
    const preset = POPUP_VIEW_PRESETS.find((v) => v.key === presetKey) ?? POPUP_VIEW_PRESETS[0];
    const dir = new THREE.Vector3(...preset.dir).normalize();
    const distance = Math.max(radius * 2.6, 1);
    target.current.pos.copy(center).addScaledVector(dir, distance);
    target.current.up.set(...preset.up);
    animating.current = true;
  }, [presetKey, center, radius]);

  useFrame(() => {
    if (presetKey === "perspective" || !animating.current) return;
    camera.position.lerp(target.current.pos, 0.2);
    camera.up.lerp(target.current.up, 0.2);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerp(center, 0.2);
      controls.update();
    }
    if (camera.position.distanceTo(target.current.pos) < 0.01) animating.current = false;
  });

  return null;
}

/** Keeps `cameraStateRef` current every frame so the popup's "Save & close"
 * handler (outside the Canvas) can read the live camera synchronously --
 * only meaningful in free Perspective mode, where there's no fixed preset
 * to just remember by key instead. */
function CameraCapture({ cameraStateRef, controlsRef }: { cameraStateRef: RefObject<{ position: [number, number, number]; target: [number, number, number] } | null>; controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null> }) {
  useFrame(({ camera }) => {
    const t = controlsRef.current?.target;
    cameraStateRef.current = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: t ? [t.x, t.y, t.z] : [0, 0, 0],
    };
  });
  return null;
}

export function TileViewEditor({ tile, slot, config, onSave, onClose }: { tile: ParsedTile; slot: BoardSlot; config: BoardConfig; onSave: (overrides: BoardSlotOverrides | undefined) => void; onClose: () => void }) {
  const initial = slot.overrides ?? {};
  const [viewMode, setViewMode] = useState<string>(initial.customCamera ? "perspective" : slot.view);
  const [foamColor, setFoamColor] = useState(initial.foamColor ?? config.foamColor);
  const [voidColor, setVoidColor] = useState(initial.voidColor ?? config.voidColor);
  const [foamOpacity, setFoamOpacity] = useState(initial.foamOpacity ?? config.foamOpacity);
  const [voidOpacity, setVoidOpacity] = useState(initial.voidOpacity ?? config.voidOpacity);
  const [clip, setClip] = useState<ClipState>(initial.clip ?? defaultClipState());
  const [foamOutline, setFoamOutline] = useState<OutlineSettings>(initial.foamOutline ?? config.foamOutline);
  const [voidOutline, setVoidOutline] = useState<OutlineSettings>(initial.voidOutline ?? config.voidOutline);
  const [foamFacetLines, setFoamFacetLines] = useState<FacetLineSettings>(initial.foamFacetLines ?? config.foamFacetLines);
  const [voidFacetLines, setVoidFacetLines] = useState<FacetLineSettings>(initial.voidFacetLines ?? config.voidFacetLines);
  const [bounds, setBounds] = useState({ center: new THREE.Vector3(), radius: 5 });

  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const cameraStateRef = useRef<{ position: [number, number, number]; target: [number, number, number] } | null>(null);
  const locked = viewMode !== "perspective";

  const handleSave = () => {
    const overrides: BoardSlotOverrides = {
      foamColor: foamColor === config.foamColor ? undefined : foamColor,
      voidColor: voidColor === config.voidColor ? undefined : voidColor,
      foamOpacity: foamOpacity === config.foamOpacity ? undefined : foamOpacity,
      voidOpacity: voidOpacity === config.voidOpacity ? undefined : voidOpacity,
      clip: clip.enabled ? clip : undefined,
      foamOutline: foamOutline.enabled ? foamOutline : undefined,
      voidOutline: voidOutline.enabled ? voidOutline : undefined,
      foamFacetLines: foamFacetLines.enabled ? foamFacetLines : undefined,
      voidFacetLines: voidFacetLines.enabled ? voidFacetLines : undefined,
      customCamera: viewMode === "perspective" ? (cameraStateRef.current ?? undefined) : undefined,
    };
    const hasAny = Object.values(overrides).some((v) => v !== undefined);
    onSave(hasAny ? overrides : undefined);
    onClose();
  };

  const handleReset = () => {
    setFoamColor(config.foamColor);
    setVoidColor(config.voidColor);
    setFoamOpacity(config.foamOpacity);
    setVoidOpacity(config.voidOpacity);
    setClip(defaultClipState());
    setFoamOutline(config.foamOutline);
    setVoidOutline(config.voidOutline);
    setFoamFacetLines(config.foamFacetLines);
    setVoidFacetLines(config.voidFacetLines);
    setViewMode(slot.view);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-background">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-label text-muted-foreground">Edit tile view · {tile.name}</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative min-h-0 bg-black/40">
            <Canvas
              dpr={[1, 2]}
              camera={{ fov: 42, near: 0.05, far: 500, position: [8, 6, 8] }}
              gl={{ antialias: true }}
              onCreated={(state) => {
                state.gl.localClippingEnabled = true;
              }}
            >
              <color attach="background" args={[config.backgroundColor]} />
              <ambientLight intensity={0.6} />
              <directionalLight position={[6, 10, 4]} intensity={1.1} />
              <directionalLight position={[-6, -4, -6]} intensity={0.25} />
              <PopupModel
                glbUrl={tile.glbUrl}
                foamColor={foamColor}
                voidColor={voidColor}
                foamOpacity={foamOpacity}
                voidOpacity={voidOpacity}
                clip={clip}
                foamOutline={foamOutline}
                voidOutline={voidOutline}
                foamFacetLines={foamFacetLines}
                voidFacetLines={voidFacetLines}
                onBounds={(center, radius) => setBounds({ center, radius })}
              />
              <AxoLockRig presetKey={viewMode} center={bounds.center} radius={bounds.radius} controlsRef={controlsRef} />
              <CameraCapture cameraStateRef={cameraStateRef} controlsRef={controlsRef} />
              <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} enableRotate={!locked} enablePan={!locked} enableZoom />
            </Canvas>
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-white/10 p-4">
            <div className="space-y-2">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">View</div>
              <select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
                {POPUP_VIEW_PRESETS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
                <option value="perspective">Perspective (free orbit)</option>
              </select>
              <p className="text-[10px] text-muted-foreground">{locked ? "Camera locked to this preset -- zoom only." : "Free orbit/pan/zoom -- the exact framing you leave it in gets captured."}</p>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Materials</div>
              <ColorField label="Foam" value={foamColor} onChange={setFoamColor} />
              <NumberSlider label="Foam opacity" value={Math.round(foamOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => setFoamOpacity(v / 100)} />
              <ColorField label="Void" value={voidColor} onChange={setVoidColor} />
              <NumberSlider label="Void opacity" value={Math.round(voidOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => setVoidOpacity(v / 100)} />
            </div>

            <div className="border-t border-border pt-3">
              <ClippingPlaneControl value={clip} onChange={setClip} />
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Outline</div>
              {([
                ["Foam", foamOutline, setFoamOutline],
                ["Void", voidOutline, setVoidOutline],
              ] as const).map(([label, setting, setSetting]) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label} outline</span>
                    <Switch checked={setting.enabled} onCheckedChange={(enabled) => setSetting({ ...setting, enabled })} />
                  </div>
                  {setting.enabled && (
                    <>
                      <ColorField label="Color" value={setting.color} onChange={(color) => setSetting({ ...setting, color })} />
                      <NumberSlider label="Opacity" value={Math.round(setting.opacity * 100)} min={5} max={100} suffix="%" onChange={(v) => setSetting({ ...setting, opacity: v / 100 })} />
                      <NumberSlider label="Weight" value={setting.weightPx} min={1} max={10} suffix="px" onChange={(weightPx) => setSetting({ ...setting, weightPx })} />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Facet lines</div>
              {([
                ["Foam", foamFacetLines, setFoamFacetLines],
                ["Void", voidFacetLines, setVoidFacetLines],
              ] as const).map(([label, setting, setSetting]) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label} facet lines</span>
                    <Switch checked={setting.enabled} onCheckedChange={(enabled) => setSetting({ ...setting, enabled })} />
                  </div>
                  {setting.enabled && (
                    <>
                      <ColorField label="Color" value={setting.color} onChange={(color) => setSetting({ ...setting, color })} />
                      <NumberSlider label="Opacity" value={Math.round(setting.opacity * 100)} min={5} max={100} suffix="%" onChange={(v) => setSetting({ ...setting, opacity: v / 100 })} />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-auto flex gap-1.5 border-t border-border pt-3">
              <Button variant="outline" size="sm" className="flex-1" onClick={handleReset}>
                Reset to board defaults
              </Button>
              <Button size="sm" className="flex-1" onClick={handleSave}>
                Save &amp; close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
