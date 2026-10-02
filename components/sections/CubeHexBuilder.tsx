"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { SquareFrame } from "@/components/shared/SquareFrame";
import { DisplayModeBar } from "@/components/viewer/DisplayModeBar";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import type { DisplayMode, MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import { ClippingPlaneControl } from "@/components/shared/ClippingPlaneControl";
import { ShuffleSeedButton } from "@/components/shared/ShuffleSeedButton";
import { ColorField } from "@/components/boards/ColorField";
import { FaceTilePicker } from "@/components/sections/FaceTilePicker";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { applyClipToMesh, buildClipOutline, buildClipPlane, buildCutFaceCap, defaultClipState, type ClipState } from "@/lib/clipping";
import { useProject } from "@/lib/project-store";
import type { BankTile } from "@/lib/sections/tileLibrary";
import { cubeFaces, facesForShape, hexSidePose, HEX_APOTHEM, prismFaces, type SectionTrace, type VolumeAssignments, type VolumeFaceName, type VolumeShape } from "@/lib/sections/volumeField";
import { buildVolumeField, type VolumeField } from "@/lib/sections/volumeField";
import { cleanupVolumeField, defaultCleanup, isCleanupActive, swapFoamVoid, type CleanupSettings } from "@/lib/sections/cleanup";
import { cubeSignature, type SavedCube } from "@/lib/sections/savedCubes";
import { evictTileRender, renderTileThumbnail } from "@/lib/renderTile";
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
function applyPreviewMaterial(mesh: THREE.Object3D | null | undefined, color: string, visible: boolean, ghosted: boolean, kind: "foam" | "void") {
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
    // Foam and void share their interface surface -- keep the void a hair behind.
    polygonOffset: true,
    polygonOffsetFactor: kind === "void" ? 2 : 1,
    polygonOffsetUnits: kind === "void" ? 2 : 1,
  });
}

/** A face's center position + outward normal + size, in the preview
 * mesh's own final (baked) local space -- i.e. plain [0, tileFt] world
 * coordinates, the same space buildTileScene's own vertices land in (see
 * mesh.ts -- the tile's cube / hex prism spans exactly this range, so
 * overlay markers need no extra transform of their own). Used only for the "Faces" display mode's
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
    applyPreviewMaterial(group.getObjectByName("foam"), colors.foam, visibility.foam, ghosted, "foam");
    applyPreviewMaterial(group.getObjectByName("void"), colors.void, visibility.void, ghosted, "void");
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

const TILE_FT: [number, number, number] = [20, 20, 20];

/** The raw lofted field for the current face assignments -- cleanup and
 * meshing happen downstream of it so the cleanup sliders can re-run without
 * re-lofting. `id` changes only on a fresh Generate, which is what re-fits
 * the preview camera (a slider drag must not). */
interface RawPreview {
  id: number;
  volume: VolumeField;
  shape: VolumeShape;
  /** The recipe this was lofted from -- what gets auto-saved. */
  cubeId: string;
  createdAt: number;
  assignmentNames: Record<string, string>;
  traces: Record<string, SectionTrace>;
  seed: number;
  fitTolerance: number;
}

function freshCubeStamp() {
  return { id: `cube-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() };
}

/** The foam + void meshes only, on a fresh group. The live preview group
 * also carries whatever the preview has parked on it (clip outline, cut-face
 * caps, face markers) -- none of which belongs in an exported file or a
 * thumbnail. */
function cleanMeshGroup(group: THREE.Group): THREE.Group {
  const out = new THREE.Group();
  out.userData = { ...group.userData };
  for (const name of ["foam", "void"]) {
    const mesh = group.getObjectByName(name);
    if (mesh instanceof THREE.Mesh) out.add(mesh.clone());
  }
  return out;
}

async function thumbnailFor(group: THREE.Group): Promise<string> {
  const glb = (await new GLTFExporter().parseAsync(cleanMeshGroup(group), { binary: true })) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  try {
    return await renderTileThumbnail(url, 96);
  } finally {
    evictTileRender(url);
    URL.revokeObjectURL(url);
  }
}

export function CubeHexBuilder({ bankTiles, allTiles, onSaved }: { bankTiles: BankTile[]; allTiles: BankTile[]; onSaved: (tile: ParsedTile) => void }) {
  const { addTile, cubes, saveCube, removeCube } = useProject();
  const [shape, setShape] = useState<VolumeShape>("cube");
  const [assignments, setAssignments] = useState<Partial<Record<VolumeFaceName, string>>>({});
  const [seed, setSeed] = useState(1);
  const [fitTolerance, setFitTolerance] = useState(50);
  const [cleanup, setCleanup] = useState<CleanupSettings>(defaultCleanup);
  const [swapped, setSwapped] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number] | "">("");
  const [typology, setTypology] = useState("");
  const [raw, setRaw] = useState<RawPreview | null>(null);
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const [assignedFaceCount, setAssignedFaceCount] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode | "faces">("rendered");
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: false });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });
  const [clip, setClip] = useState<ClipState>(defaultClipState());
  const [faceOverlays, setFaceOverlays] = useState<Partial<Record<VolumeFaceName, FaceOverlaySettings>>>({});
  const [openFace, setOpenFace] = useState<string | null>(null);
  const [pool, setPool] = useState<"checked" | "all">("checked");
  const rawCounter = useRef(0);
  const [busy, setBusy] = useState(false);
  const [exportingAnalysis, setExportingAnalysis] = useState(false);

  const faceNames = facesForShape(shape);
  const tileByName = useMemo(() => new Map(allTiles.map((t) => [t.name, t])), [allTiles]);
  const savedCubes = useMemo(() => [...cubes].sort((a, b) => b.createdAt - a.createdAt), [cubes]);
  const cubesRef = useRef(cubes);
  useEffect(() => {
    cubesRef.current = cubes;
  }, [cubes]);
  // With nothing checked in the bank the builder falls back to the whole
  // bank, so it's usable on its own (e.g. just to revisit saved objects).
  const effectivePool = bankTiles.length ? pool : "all";
  const poolTiles = effectivePool === "all" ? allTiles : bankTiles;

  const volAssignments = useMemo((): VolumeAssignments => {
    const out: VolumeAssignments = {};
    for (const face of faceNames) {
      const tileName = assignments[face];
      const tile = tileName ? tileByName.get(tileName) : undefined;
      if (tile) (out as Record<string, typeof tile.proposal>)[face] = tile.proposal;
    }
    return out;
  }, [assignments, faceNames, tileByName]);

  // Cleanup runs on the already-lofted field, deferred so dragging a slider
  // stays smooth while the (heavier) clean + remesh catches up behind it.
  const deferredCleanup = useDeferredValue(cleanup);
  const deferredSwapped = useDeferredValue(swapped);
  const built = useMemo(() => {
    if (!raw) return null;
    const lofted = deferredSwapped ? swapFoamVoid(raw.volume) : raw.volume;
    const { volume, stats } = cleanupVolumeField(lofted, deferredCleanup, TILE_FT[0]);
    return { group: buildTileScene(volume.field, volume.resolution, TILE_FT, raw.shape), stats };
  }, [raw, deferredCleanup, deferredSwapped]);
  const previewGroup = built?.group ?? null;
  const cleanupStats = built && isCleanupActive(deferredCleanup) ? built.stats : null;

  useEffect(() => {
    if (!previewGroup) return;
    return () => {
      previewGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    };
  }, [previewGroup]);

  // Every piece made here is kept with the project code automatically --
  // saved on Generate and kept up to date as cleanup / swap / name change,
  // whether or not it is ever added to the tile bank.
  useEffect(() => {
    if (!raw || !built) return;
    const existing = cubesRef.current.find((c) => c.id === raw.cubeId);
    const entry = {
      name: name.trim() || existing?.name || `Cube ${cubesRef.current.length + 1}`,
      shape: raw.shape,
      assignments: raw.assignmentNames,
      traces: raw.traces,
      seed: raw.seed,
      fitTolerance: raw.fitTolerance,
      cleanup: deferredCleanup,
      swapped: deferredSwapped,
    };
    if (existing && existing.thumb && cubeSignature(existing) === cubeSignature(entry)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const sameShape = existing && cubeSignature({ ...existing, name: "" }) === cubeSignature({ ...entry, name: "" });
      let thumb = sameShape ? existing?.thumb : undefined;
      if (!thumb) {
        try {
          thumb = await thumbnailFor(built.group);
        } catch {
          // A missing thumbnail only costs the list a picture.
        }
      }
      if (!cancelled) saveCube({ id: raw.cubeId, createdAt: existing?.createdAt ?? raw.createdAt, thumb, ...entry });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [raw, built, deferredCleanup, deferredSwapped, name, saveCube]);

  const generateFrom = (shapeNow: VolumeShape, traces: VolumeAssignments, names: Record<string, string>, seedNow: number, fitNow: number, reuse?: { id: string; createdAt: number }) => {
    const volume = buildVolumeField(traces, shapeNow, seedNow, fitNow, 46);
    setFaceFit(volume.faceFit);
    setAssignedFaceCount(Object.keys(traces).length);
    rawCounter.current += 1;
    // Pressing Generate again on a recipe that is already saved reuses that
    // saved piece instead of adding a duplicate.
    const fresh = freshCubeStamp();
    const same = reuse ?? cubes.find((c) => c.shape === shapeNow && c.seed === seedNow && c.fitTolerance === fitNow && JSON.stringify(c.assignments) === JSON.stringify(names));
    setRaw({
      id: rawCounter.current,
      volume,
      shape: shapeNow,
      cubeId: same?.id ?? fresh.id,
      createdAt: same?.createdAt ?? fresh.createdAt,
      assignmentNames: names,
      traces: traces as Record<string, SectionTrace>,
      seed: seedNow,
      fitTolerance: fitNow,
    });
    setFaceOverlays((prev) => {
      const next = { ...prev };
      let i = 0;
      for (const face of Object.keys(traces) as VolumeFaceName[]) {
        if (!next[face]) next[face] = defaultFaceOverlay(i);
        i++;
      }
      return next;
    });
  };

  const generatePreview = () => {
    if (!Object.keys(volAssignments).length) {
      toast.error("Assign at least one tile to a face first.");
      return;
    }
    generateFrom(shape, volAssignments, Object.fromEntries(Object.entries(assignments).filter(([, v]) => v)) as Record<string, string>, seed, fitTolerance);
  };

  const autoFillEmptyFaces = () => {
    if (!poolTiles.length) {
      toast.error("No tiles to pick from.");
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      for (const face of faceNames) {
        if (next[face]) continue;
        next[face] = poolTiles[Math.floor(Math.random() * poolTiles.length)].name;
      }
      return next;
    });
  };

  const loadCube = (cube: SavedCube) => {
    setShape(cube.shape);
    setAssignments(cube.assignments);
    setSeed(cube.seed);
    setFitTolerance(cube.fitTolerance);
    setCleanup(cube.cleanup);
    setSwapped(cube.swapped);
    setName(cube.name);
    setClip(defaultClipState());
    setOpenFace(null);
    setFaceOverlays({});
    // Lofted straight from the traces stored with the piece, so it comes back
    // exactly as it was made.
    generateFrom(cube.shape, cube.traces, cube.assignments, cube.seed, cube.fitTolerance, { id: cube.id, createdAt: cube.createdAt });
    toast.success(`Opened "${cube.name}".`);
  };

  const buildInput = (): BuildSectionTileInput => ({
    name: name.trim(),
    shape,
    assignments: volAssignments,
    assignmentNames: assignments,
    seed,
    fitTolerance,
    cleanup,
    swapped,
    guessed: category ? { category, typology: typology.trim() || undefined } : {},
  });

  const saveAsTile = async () => {
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
      const tile = await buildSectionTile(buildInput());
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
    downloadTextFile(`${(name.trim() || "section_tile").replace(/\s+/g, "_")}.obj`, groupToObjText(cleanMeshGroup(previewGroup)));
  };

  const exportAnalysisBundle = async () => {
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
      const tile = await buildSectionTile(buildInput());
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
    <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)]">
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Shape</div>
            <div className="flex gap-1.5">
              {(["cube", "hex-prism"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={shape === s ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setShape(s);
                    setAssignments({});
                    setRaw(null);
                    setFaceOverlays({});
                    setOpenFace(null);
                  }}
                >
                  {s === "cube" ? "Cube" : "Hex prism"}
                </Button>
              ))}
            </div>
          </div>
        </GlowPanel>
        <GlowPanel glow="orange">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Faces</div>
              <Button size="sm" variant="outline" onClick={autoFillEmptyFaces}>
                Auto-fill empty
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>Pick from</span>
              <div className="inline-flex rounded-full border-hair p-0.5">
                {(["checked", "all"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={p === "checked" && !bankTiles.length}
                    onClick={() => setPool(p)}
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-label transition-colors disabled:opacity-40 ${
                      effectivePool === p ? "bg-gradient-to-r from-magenta to-orange text-white" : "hover:text-foreground"
                    }`}
                  >
                    {p === "checked" ? `Checked (${bankTiles.length})` : `Whole bank (${allTiles.length})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              {faceNames.map((face) => (
                <FaceTilePicker
                  key={face}
                  face={face}
                  assigned={assignments[face] ? tileByName.get(assignments[face]!) : undefined}
                  options={poolTiles}
                  open={openFace === face}
                  onToggle={() => setOpenFace((prev) => (prev === face ? null : face))}
                  onChange={(tileName) => {
                    setAssignments((prev) => ({ ...prev, [face]: tileName }));
                    setOpenFace(null);
                  }}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {shape === "cube" ? `${cubeFaces.length} faces` : `${prismFaces.length} faces (6 sides + top/bottom)`} · tap a face to pick its tile.
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
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>
                Swap foam &amp; void
                <span className="block text-[10px] text-muted-foreground">{swapped ? "foam = the cube minus your shape" : "foam = your shape, void = the rest"}</span>
              </span>
              <Switch checked={swapped} onCheckedChange={setSwapped} />
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
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Cleanup</div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!isCleanupActive(cleanup)} onClick={() => setCleanup(defaultCleanup)}>
                Reset
              </Button>
            </div>
            <NumberSlider label="Delete floating pieces under" value={cleanup.minPieceFt3} min={0} max={800} step={1} decimals={0} suffix=" ft³" exact onChange={(minPieceFt3) => setCleanup((c) => ({ ...c, minPieceFt3 }))} />
            <NumberSlider label="Shave branches thinner than" value={cleanup.minBranchFt} min={0} max={4} step={0.05} decimals={2} suffix=" ft" exact onChange={(minBranchFt) => setCleanup((c) => ({ ...c, minBranchFt }))} />
            <NumberSlider label="Fill sealed void pockets under" value={cleanup.minPocketFt3} min={0} max={800} step={1} decimals={0} suffix=" ft³" exact onChange={(minPocketFt3) => setCleanup((c) => ({ ...c, minPocketFt3 }))} />
            <p className="text-[11px] text-muted-foreground">
              {cleanupStats
                ? [
                    cleanupStats.pieces ? `removed ${cleanupStats.pieces} floating piece${cleanupStats.pieces === 1 ? "" : "s"} (${cleanupStats.piecesFt3.toFixed(1)} ft³)` : null,
                    cleanupStats.branchFt3 > 0 ? `shaved ${cleanupStats.branchFt3.toFixed(1)} ft³ of thin branches` : null,
                    cleanupStats.pockets ? `filled ${cleanupStats.pockets} void pocket${cleanupStats.pockets === 1 ? "" : "s"} (${cleanupStats.pocketsFt3.toFixed(1)} ft³)` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "nothing met those thresholds yet"
                : "Off at 0. Anything touching a tile face is never treated as floating -- it may carry on into the next tile."}
            </p>
          </div>
        </GlowPanel>
        {savedCubes.length > 0 && (
          <GlowPanel glow="orange">
            <div className="space-y-2 p-4">
              <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Saved objects ({savedCubes.length})</div>
              <p className="text-[10px] text-muted-foreground">Every piece you generate is kept with this project code automatically.</p>
              <div className="space-y-1">
                {savedCubes.map((c) => (
                  <div key={c.id} className="flex items-center gap-1 rounded-md border border-input pr-1 transition-colors hover:border-magenta/50">
                    <button onClick={() => loadCube(c)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs">
                      <span className="inline-block h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                        {c.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumb} alt="" className="h-full w-full object-contain" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {c.shape} · seed {c.seed}
                          {c.swapped ? " · swapped" : ""}
                        </span>
                      </span>
                    </button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground" aria-label={`Delete ${c.name}`} title="Delete this saved object" onClick={() => removeCube(c.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </GlowPanel>
        )}
      </div>

      <div className="order-1 min-w-0 lg:order-2 lg:min-h-0">
        <div className="h-[min(100vw,70vh)] lg:h-full">
          <SquareFrame className="relative">
            {previewGroup && raw ? (
              <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
                <Canvas
                  dpr={[1, 2]}
                  camera={{ fov: 45, position: [15, 12, 15] }}
                  gl={{ antialias: true, stencil: true }}
                  onCreated={(state) => {
                    state.gl.localClippingEnabled = true;
                  }}
                >
                  <color attach="background" args={["#0a0a0b"]} />
                  <ambientLight intensity={0.6} />
                  <directionalLight position={[10, 16, 8]} intensity={1.1} />
                  <directionalLight position={[-8, -6, -8]} intensity={0.25} />
                  <Bounds key={raw.id} fit clip observe margin={1.3}>
                    <PreviewScene
                      group={previewGroup}
                      displayMode={displayMode}
                      visibility={visibility}
                      colors={colors}
                      clip={clip}
                      assignments={volAssignments}
                      faceOverlays={faceOverlays}
                      shape={raw.shape}
                    />
                  </Bounds>
                  <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
                </Canvas>
              </div>
            ) : (
              <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">
                Assign tiles to faces, then Generate preview{savedCubes.length ? " -- or open one of your saved objects." : "."}
              </div>
            )}
          </SquareFrame>
        </div>
      </div>

      <div className="order-3 flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
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
