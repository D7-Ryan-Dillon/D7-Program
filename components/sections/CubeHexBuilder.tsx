"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { SquareFrame } from "@/components/shared/SquareFrame";
import { DisplayModeBar } from "@/components/viewer/DisplayModeBar";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import type { DisplayMode, MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import { ClippingPlaneControl } from "@/components/shared/ClippingPlaneControl";
import { ShuffleSeedButton } from "@/components/shared/ShuffleSeedButton";
import { ColorField } from "@/components/boards/ColorField";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { applyClipToMesh, buildClipOutline, buildClipPlane, buildCutFaceCap, defaultClipState, type ClipState } from "@/lib/clipping";
import { useProject } from "@/lib/project-store";
import type { BankTile } from "@/lib/sections/tileLibrary";
import { cubeFaces, facesForShape, hexSidePose, HEX_APOTHEM, prismFaces, type VolumeAssignments, type VolumeFaceName, type VolumeShape } from "@/lib/sections/volumeField";
import { buildVolumeField } from "@/lib/sections/volumeField";
import { buildTileScene } from "@/lib/sections/mesh";
import { buildSectionTile, type BuildSectionTileInput } from "@/lib/sections/buildTile";
import { buildAnalysisZip } from "@/lib/sections/exportAnalysis";
import { groupToObjText, downloadTextFile } from "@/lib/exporters/objExport";
import { downloadBlob } from "@/lib/boards/exportBoard";
import type { ParsedTile } from "@/lib/types";

const CATEGORY_OPTIONS = ["gathering", "office", "lobby"] as const;

interface FaceOverlaySettings {
  visible: boolean;
  color: string;
  opacity: number;
}

const OVERLAY_PALETTE = ["#e8a6c8", "#c43383", "#db7228", "#f2b878", "#9aa0a6", "#e6e6e6", "#5ec8c8", "#8a7fd1"];

function defaultFaceOverlay(index: number): FaceOverlaySettings {
  return { visible: true, color: OVERLAY_PALETTE[index % OVERLAY_PALETTE.length], opacity: 0.55 };
}

// Same material convention as ThreeViewport's applyMaterial: always
// double-sided (a lofted/blended field can fold into thin branching sheets,
// not just chunky solids), transparent+dim when ghosted.
function applyPreviewMaterial(mesh: THREE.Object3D | null | undefined, color: string, visible: boolean, ghosted: boolean) {
  if (!(mesh instanceof THREE.Mesh)) return;
  mesh.visible = visible;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    transparent: ghosted,
    opacity: ghosted ? 0.22 : 1,
    depthWrite: !ghosted,
    side: THREE.DoubleSide,
  });
}

/** A face's center position + outward normal + size, in the preview
 * mesh's own final (baked) local space -- i.e. plain [0, tileFt] world
 * coordinates, the same space buildTileScene's own vertices land in (see
 * mesh.ts's marchSignedField -- the scale compensation already puts real
 * geometry at exactly this range, so overlay markers need no extra
 * transform of their own). Used only for the "Faces" display mode's
 * translucent per-face markers -- never the solid mesh itself. */
function faceOverlayTransform(
  face: VolumeFaceName,
  shape: VolumeShape,
  tileFt: [number, number, number],
): { position: THREE.Vector3; normal: THREE.Vector3; width: number; height: number } | null {
  const [tx, ty, tz] = tileFt;
  if (shape === "cube" || face === "top" || face === "bottom") {
    switch (face) {
      case "front":
        return { position: new THREE.Vector3(tx / 2, ty / 2, 0), normal: new THREE.Vector3(0, 0, -1), width: tx, height: ty };
      case "back":
        return { position: new THREE.Vector3(tx / 2, ty / 2, tz), normal: new THREE.Vector3(0, 0, 1), width: tx, height: ty };
      case "left":
        return { position: new THREE.Vector3(0, ty / 2, tz / 2), normal: new THREE.Vector3(-1, 0, 0), width: tz, height: ty };
      case "right":
        return { position: new THREE.Vector3(tx, ty / 2, tz / 2), normal: new THREE.Vector3(1, 0, 0), width: tz, height: ty };
      case "top":
        return { position: new THREE.Vector3(tx / 2, ty, tz / 2), normal: new THREE.Vector3(0, 1, 0), width: tx, height: tz };
      case "bottom":
        return { position: new THREE.Vector3(tx / 2, 0, tz / 2), normal: new THREE.Vector3(0, -1, 0), width: tx, height: tz };
      default:
        return null;
    }
  }
  if (face.startsWith("side")) {
    const index = Number(face.slice(4)) - 1;
    const { angle } = hexSidePose(index);
    const worldX = Math.cos(angle) * HEX_APOTHEM;
    const worldZ = Math.sin(angle) * HEX_APOTHEM;
    const x = ((worldX + 1) / 2) * tx;
    const z = ((worldZ + 1) / 2) * tz;
    const sideLength = ((Math.sin(Math.PI / 3) * 2 * HEX_APOTHEM) / 2) * tx; // hex side width at this apothem/scale
    return { position: new THREE.Vector3(x, ty / 2, z), normal: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), width: sideLength, height: ty };
  }
  return null;
}

function buildFaceOverlayGroup(
  assignments: VolumeAssignments,
  overlays: Partial<Record<VolumeFaceName, FaceOverlaySettings>>,
  shape: VolumeShape,
  tileFt: [number, number, number],
): THREE.Group {
  const group = new THREE.Group();
  group.name = "face-overlays";
  for (const face of Object.keys(assignments) as VolumeFaceName[]) {
    const setting = overlays[face] ?? defaultFaceOverlay(0);
    if (!setting.visible) continue;
    const transform = faceOverlayTransform(face, shape, tileFt);
    if (!transform) continue;
    const geometry = new THREE.PlaneGeometry(transform.width, transform.height);
    const material = new THREE.MeshBasicMaterial({ color: setting.color, opacity: setting.opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(transform.position);
    mesh.lookAt(transform.position.clone().add(transform.normal));
    group.add(mesh);
  }
  return group;
}

function PreviewScene({
  group,
  displayMode,
  visibility,
  colors,
  clip,
  assignments,
  faceOverlays,
  shape,
}: {
  group: THREE.Group;
  displayMode: DisplayMode | "faces";
  visibility: MeshVisibility;
  colors: MeshColors;
  clip: ClipState;
  assignments: VolumeAssignments;
  faceOverlays: Partial<Record<VolumeFaceName, FaceOverlaySettings>>;
  shape: VolumeShape;
}) {
  useEffect(() => {
    const ghosted = displayMode === "ghosted";
    applyPreviewMaterial(group.getObjectByName("foam"), colors.foam, visibility.foam, ghosted);
    applyPreviewMaterial(group.getObjectByName("void"), colors.void, visibility.void, ghosted);
  }, [group, displayMode, visibility, colors]);

  useEffect(() => {
    const extras: THREE.Object3D[] = [];
    const foam = group.getObjectByName("foam");
    const voidMesh = group.getObjectByName("void");
    const meshes = [foam, voidMesh].filter((m): m is THREE.Mesh => m instanceof THREE.Mesh);

    if (!clip.enabled) {
      for (const mesh of meshes) applyClipToMesh(mesh, null);
    } else {
      const box = new THREE.Box3().setFromObject(group);
      const plane = buildClipPlane(clip, box);
      for (const mesh of meshes) applyClipToMesh(mesh, plane);
      const outline = buildClipOutline(clip, box);
      group.add(outline);
      extras.push(outline);
      if (clip.cutFace?.enabled) {
        if (foam instanceof THREE.Mesh) {
          const cap = buildCutFaceCap(foam, plane, box, clip, clip.cutFace.foamColor, clip.cutFace.foamOpacity);
          group.add(cap);
          extras.push(cap);
        }
        if (voidMesh instanceof THREE.Mesh) {
          const cap = buildCutFaceCap(voidMesh, plane, box, clip, clip.cutFace.voidColor, clip.cutFace.voidOpacity);
          group.add(cap);
          extras.push(cap);
        }
      }
    }

    const existingOverlay = group.getObjectByName("face-overlays");
    if (existingOverlay) existingOverlay.removeFromParent();
    if (displayMode === "faces") {
      const overlayGroup = buildFaceOverlayGroup(assignments, faceOverlays, shape, [20, 20, 20]);
      group.add(overlayGroup);
      extras.push(overlayGroup);
    }

    return () => {
      for (const obj of extras) obj.removeFromParent();
    };
  }, [group, clip, displayMode, assignments, faceOverlays, shape]);

  return <primitive object={group} />;
}

export function CubeHexBuilder({ bankTiles, onSaved }: { bankTiles: BankTile[]; onSaved: (tile: ParsedTile) => void }) {
  const { addTile, tiles } = useProject();
  const [shape, setShape] = useState<VolumeShape>("cube");
  const [assignments, setAssignments] = useState<Partial<Record<VolumeFaceName, string>>>({});
  const [seed, setSeed] = useState(1);
  const [fitTolerance, setFitTolerance] = useState(50);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number] | "">("");
  const [typology, setTypology] = useState("");
  const [previewGroup, setPreviewGroup] = useState<THREE.Group | null>(null);
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const [assignedFaceCount, setAssignedFaceCount] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode | "faces">("rendered");
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: true });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });
  const [clip, setClip] = useState<ClipState>(defaultClipState());
  const [faceOverlays, setFaceOverlays] = useState<Partial<Record<VolumeFaceName, FaceOverlaySettings>>>({});
  const [busy, setBusy] = useState(false);
  const [exportingAnalysis, setExportingAnalysis] = useState(false);

  const faceNames = facesForShape(shape);
  const tileByName = useMemo(() => new Map(bankTiles.map((t) => [t.name, t])), [bankTiles]);
  const savedSectionTiles = useMemo(() => tiles.filter((t) => t.sectionRecipe), [tiles]);

  const buildAssignments = (): VolumeAssignments => {
    const out: VolumeAssignments = {};
    for (const face of faceNames) {
      const tileName = assignments[face];
      const tile = tileName ? tileByName.get(tileName) : undefined;
      if (tile) (out as Record<string, typeof tile.proposal>)[face] = tile.proposal;
    }
    return out;
  };

  const generatePreview = () => {
    const volAssignments = buildAssignments();
    if (!Object.keys(volAssignments).length) {
      toast.error("Assign at least one tile to a face first.");
      return;
    }
    const volume = buildVolumeField(volAssignments, shape, seed, fitTolerance, 46);
    setFaceFit(volume.faceFit);
    setAssignedFaceCount(Object.keys(volAssignments).length);
    setPreviewGroup(buildTileScene(volume.field, volume.resolution));
    setFaceOverlays((prev) => {
      const next = { ...prev };
      let i = 0;
      for (const face of Object.keys(volAssignments) as VolumeFaceName[]) {
        if (!next[face]) next[face] = defaultFaceOverlay(i);
        i++;
      }
      return next;
    });
  };

  const autoFillEmptyFaces = () => {
    if (!bankTiles.length) {
      toast.error("No bank tiles checked to pick from.");
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      for (const face of faceNames) {
        if (next[face]) continue;
        next[face] = bankTiles[Math.floor(Math.random() * bankTiles.length)].name;
      }
      return next;
    });
  };

  const loadRecipe = (tile: ParsedTile) => {
    const recipe = tile.sectionRecipe;
    if (!recipe) return;
    setShape(recipe.shape);
    setAssignments(recipe.assignments);
    setSeed(recipe.seed);
    setFitTolerance(recipe.fitTolerance);
    toast.success(`Loaded "${tile.name}" back into the builder -- adjust and Generate preview to continue.`);
  };

  const saveAsTile = async () => {
    const volAssignments = buildAssignments();
    if (!Object.keys(volAssignments).length) {
      toast.error("Assign at least one tile to a face first.");
      return;
    }
    if (!name.trim()) {
      toast.error("Name the tile before saving.");
      return;
    }
    setBusy(true);
    try {
      const input: BuildSectionTileInput = {
        name: name.trim(),
        shape,
        assignments: volAssignments,
        assignmentNames: assignments,
        seed,
        fitTolerance,
        guessed: category ? { category, typology: typology.trim() || undefined } : {},
      };
      const tile = await buildSectionTile(input);
      addTile(tile);
      onSaved(tile);
      toast.success(`Saved "${tile.name}" to the tile bank`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build this tile.");
    } finally {
      setBusy(false);
    }
  };

  const exportObj = () => {
    if (!previewGroup) {
      toast.error("Generate a preview first.");
      return;
    }
    downloadTextFile(`${(name.trim() || "section_tile").replace(/\s+/g, "_")}.obj`, groupToObjText(previewGroup));
  };

  const exportAnalysisBundle = async () => {
    const volAssignments = buildAssignments();
    if (!Object.keys(volAssignments).length) {
      toast.error("Assign at least one tile to a face first.");
      return;
    }
    if (!name.trim()) {
      toast.error("Name the tile before exporting.");
      return;
    }
    setExportingAnalysis(true);
    try {
      const tile = await buildSectionTile({
        name: name.trim(),
        shape,
        assignments: volAssignments,
        assignmentNames: assignments,
        seed,
        fitTolerance,
        guessed: category ? { category, typology: typology.trim() || undefined } : {},
      });
      const { blob, fileCount } = await buildAnalysisZip(tile);
      downloadBlob(`${tile.name}_analysis.zip`, blob);
      toast.success(`Exported ${fileCount} files to ${tile.name}_analysis.zip`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the _analysis bundle.");
    } finally {
      setExportingAnalysis(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_280px] grid-rows-[minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Shape</div>
            <div className="flex gap-1.5">
              {(["cube", "hex-prism"] as const).map((s) => (
                <Button key={s} size="sm" variant={shape === s ? "default" : "outline"} className="flex-1" onClick={() => { setShape(s); setAssignments({}); setPreviewGroup(null); setFaceOverlays({}); }}>
                  {s === "cube" ? "Cube" : "Hex prism"}
                </Button>
              ))}
            </div>
          </div>
        </GlowPanel>
        <GlowPanel glow="orange">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Faces</div>
              <Button size="sm" variant="outline" onClick={autoFillEmptyFaces}>
                Auto-fill empty
              </Button>
            </div>
            {faceNames.map((face) => (
              <label key={face} className="flex items-center justify-between gap-2 text-xs">
                <span className="w-16 shrink-0 font-mono uppercase text-muted-foreground">{face}</span>
                <select
                  className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                  value={assignments[face] ?? ""}
                  onChange={(e) => setAssignments((prev) => ({ ...prev, [face]: e.target.value || undefined }))}
                >
                  <option value="">—</option>
                  {bankTiles.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">
              {shape === "cube" ? `${cubeFaces.length} faces` : `${prismFaces.length} faces (6 sides + top/bottom)`} · pick from tiles checked in the bank, or any tile below.
            </p>
          </div>
        </GlowPanel>
        <GlowPanel glow="orange">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Display</div>
            <DisplayModeBar mode={displayMode} onChange={setDisplayMode} modes={[{ key: "rendered", label: "Rendered" }, { key: "ghosted", label: "Ghosted" }, { key: "faces", label: "Faces" }]} />
          </div>
        </GlowPanel>
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Loft settings</div>
            <label className="block text-xs">
              Seed
              <div className="mt-1 flex gap-1.5">
                <Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="h-8" />
                <ShuffleSeedButton onShuffle={setSeed} />
              </div>
            </label>
            <label className="block text-xs">
              Seam fit tolerance ({fitTolerance})
              <input type="range" min={0} max={100} value={fitTolerance} onChange={(e) => setFitTolerance(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <Button className="w-full" onClick={generatePreview}>
              Generate preview
            </Button>
            {faceFit !== null && (
              <p className="text-[11px] text-muted-foreground">
                {assignedFaceCount} face constraint{assignedFaceCount === 1 ? "" : "s"} · {faceFit}% face fit (how much of each drawn trace survived the loft unchanged)
              </p>
            )}
          </div>
        </GlowPanel>
        {savedSectionTiles.length > 0 && (
          <GlowPanel glow="orange">
            <div className="space-y-2 p-4">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Saved objects</div>
              <div className="space-y-1">
                {savedSectionTiles.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => loadRecipe(t)}
                    className="block w-full rounded-md border border-input px-2 py-1.5 text-left text-xs transition-colors hover:border-magenta/50"
                  >
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {t.sectionRecipe?.shape} · seed {t.sectionRecipe?.seed}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </GlowPanel>
        )}
      </div>

      <div className="min-h-0 min-w-0">
        <SquareFrame className="relative">
          {previewGroup ? (
            <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
              <Canvas
                dpr={[1, 2]}
                camera={{ fov: 45, position: [15, 12, 15] }}
                gl={{ antialias: true }}
                onCreated={(state) => {
                  state.gl.localClippingEnabled = true;
                }}
              >
                <color attach="background" args={["#0a0a0b"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[10, 16, 8]} intensity={1.1} />
                <directionalLight position={[-8, -6, -8]} intensity={0.25} />
                <Bounds key={previewGroup.uuid} fit clip observe margin={1.3}>
                  <PreviewScene
                    group={previewGroup}
                    displayMode={displayMode}
                    visibility={visibility}
                    colors={colors}
                    clip={clip}
                    assignments={buildAssignments()}
                    faceOverlays={faceOverlays}
                    shape={shape}
                  />
                </Bounds>
                <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
              </Canvas>
            </div>
          ) : (
            <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">
              Assign tiles to faces, then Generate preview.
            </div>
          )}
        </SquareFrame>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <GlowPanel glow="orange">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Visibility</div>
            <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
          </div>
        </GlowPanel>
        {displayMode === "faces" && (
          <GlowPanel glow="magenta">
            <div className="space-y-3 p-4">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Face markers</div>
              {(Object.keys(assignments) as VolumeFaceName[])
                .filter((f) => assignments[f])
                .map((face) => {
                  const setting = faceOverlays[face] ?? defaultFaceOverlay(0);
                  return (
                    <div key={face} className="space-y-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-muted-foreground">{face}</span>
                        <input
                          type="checkbox"
                          checked={setting.visible}
                          onChange={(e) => setFaceOverlays((prev) => ({ ...prev, [face]: { ...setting, visible: e.target.checked } }))}
                        />
                      </div>
                      {setting.visible && (
                        <>
                          <ColorField label="Color" value={setting.color} onChange={(color) => setFaceOverlays((prev) => ({ ...prev, [face]: { ...setting, color } }))} />
                          <NumberSlider
                            label="Opacity"
                            value={Math.round(setting.opacity * 100)}
                            min={5}
                            max={100}
                            suffix="%"
                            onChange={(v) => setFaceOverlays((prev) => ({ ...prev, [face]: { ...setting, opacity: v / 100 } }))}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </GlowPanel>
        )}
        <GlowPanel glow="orange">
          <div className="p-4">
            <ClippingPlaneControl value={clip} onChange={setClip} />
          </div>
        </GlowPanel>
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Name &amp; export</div>
            <label className="block text-xs">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8" placeholder="my_cube_tile" />
            </label>
            <label className="block text-xs">
              Category
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="">—</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Typology
              <Input value={typology} onChange={(e) => setTypology(e.target.value)} className="mt-1 h-8" placeholder="e.g. folded plate" />
            </label>
            <Button className="w-full" disabled={busy} onClick={() => void saveAsTile()}>
              {busy ? "Building…" : "Save to Tile Bank"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Adds it to this project&rsquo;s tile bank -- usable in Viewer and Analysis right away.
            </p>
            <div className="flex gap-1.5 pt-1">
              <Button className="flex-1" variant="outline" size="sm" onClick={exportObj}>
                Export OBJ
              </Button>
              <Button className="flex-1" variant="outline" size="sm" disabled={exportingAnalysis} onClick={() => void exportAnalysisBundle()}>
                {exportingAnalysis ? "Building…" : "Export _analysis"}
              </Button>
            </div>
          </div>
        </GlowPanel>
      </div>
    </div>
  );
}
