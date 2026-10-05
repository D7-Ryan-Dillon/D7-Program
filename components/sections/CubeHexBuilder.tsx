"use client";

import { Select } from "@/components/ui/select";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrintPanel } from "@/components/viewer/PrintPanel";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { LoadingCover } from "@/components/shared/LoadingCover";
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
import { useProject, useProjectUi } from "@/lib/project-store";
import { useUiField } from "@/lib/useUiField";
import { CaptureBridge } from "@/components/shared/CaptureBridge";
import { ViewportTools } from "@/components/shared/ViewportTools";
import { Segmented } from "@/components/shared/Segmented";
import { Section } from "@/components/shared/Section";
import type { ViewportHandle } from "@/lib/viewportCapture";
import { rotateTrace } from "@/lib/sections/rotateTrace";
import { autoFill } from "@/lib/sections/autoFill";
import { useShortcuts } from "@/lib/shortcuts";
import { applyPlates, arePlatesActive, defaultPlates, type PlateFootprint, type PlateSettings } from "@/lib/sections/plates";
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

const OVERLAY_PALETTE = ["#e8a6c8", "#c43383", "#db7228", "#f2b878", "#9a9a9a", "#e6e6e6", "#ff269e", "#8a8a8a"];

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
    return () => {
      // The next run builds fresh materials; free this run's.
      for (const name of ["foam", "void"]) {
        const m = (group.getObjectByName(name) as THREE.Mesh | undefined)?.material;
        if (m && !Array.isArray(m)) m.dispose();
      }
    };
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
/** The loft's own seed / seam-fit settings are fixed -- they only ever shifted the result slightly. Saved pieces keep the values they were made with. */
const BUILD_SEED = 1;
const BUILD_FIT_TOLERANCE = 50;

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
  rotations: Record<string, number>;
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

/** What the builder remembers per project (the generated preview itself re-makes with Generate; every piece is already kept under Saved objects). */
interface BuilderUi {
  shape: VolumeShape;
  assignments: Partial<Record<VolumeFaceName, string>>;
  /** Quarter turns (0-3) given to each face's tile. */
  rotations: Partial<Record<VolumeFaceName, number>>;
  /** Faces Auto-fill leaves alone. */
  locks: Partial<Record<VolumeFaceName, boolean>>;
  cleanup: CleanupSettings;
  swapped: boolean;
  plates: PlateSettings;
  name: string;
  category: (typeof CATEGORY_OPTIONS)[number] | "";
  typology: string;
  displayMode: DisplayMode | "faces";
  visibility: MeshVisibility;
  colors: MeshColors;
  clip: ClipState;
  pool: "checked" | "all";
  autoRotate: boolean;
  rotateSecs: number;
}
const defaultBuilderUi = (): BuilderUi => ({
  shape: "cube",
  assignments: {},
  rotations: {},
  locks: {},
  cleanup: defaultCleanup,
  swapped: false,
  plates: defaultPlates(),
  name: "",
  category: "",
  typology: "",
  displayMode: "rendered",
  visibility: { foam: true, void: false },
  colors: { foam: "#e8a6c8", void: "#1c1c1c" },
  clip: defaultClipState(),
  pool: "checked",
  autoRotate: false,
  rotateSecs: 24,
});

export function CubeHexBuilder({ bankTiles, allTiles, onSaved }: { bankTiles: BankTile[]; allTiles: BankTile[]; onSaved: (tile: ParsedTile) => void }) {
  const { addTile, cubes, saveCube, removeCube } = useProject();
  const [bui, setBui] = useProjectUi<BuilderUi>("builder", defaultBuilderUi);
  const [shape, setShape] = useUiField(bui, setBui, "shape");
  const [assignments, setAssignments] = useUiField(bui, setBui, "assignments");
  const [rotations, setRotations] = useUiField(bui, setBui, "rotations");
  const [locks, setLocks] = useUiField(bui, setBui, "locks");
  const [cleanup, setCleanup] = useUiField(bui, setBui, "cleanup");
  const [swapped, setSwapped] = useUiField(bui, setBui, "swapped");
  const [plates, setPlates] = useUiField(bui, setBui, "plates");
  const [name, setName] = useUiField(bui, setBui, "name");
  const [category, setCategory] = useUiField(bui, setBui, "category");
  const [typology, setTypology] = useUiField(bui, setBui, "typology");
  const [autoRotate, setAutoRotate] = useUiField(bui, setBui, "autoRotate");
  const [rotateSecs, setRotateSecs] = useUiField(bui, setBui, "rotateSecs");
  const viewportHandle = useRef<ViewportHandle | null>(null);
  const [raw, setRaw] = useState<RawPreview | null>(null);
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const [assignedFaceCount, setAssignedFaceCount] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useUiField(bui, setBui, "displayMode");
  const [visibility, setVisibility] = useUiField(bui, setBui, "visibility");
  const [colors, setColors] = useUiField(bui, setBui, "colors");
  const [clip, setClip] = useUiField(bui, setBui, "clip");
  const [faceOverlays, setFaceOverlays] = useState<Partial<Record<VolumeFaceName, FaceOverlaySettings>>>({});
  const [openFace, setOpenFace] = useState<string | null>(null);
  const [pool, setPool] = useUiField(bui, setBui, "pool");
  const rawCounter = useRef(0);
  const [busy, setBusy] = useState(false);
  const [exportingAnalysis, setExportingAnalysis] = useState(false);
  /** The tile built for the Print STL dialog (the same build "Add tile" and "Export _analysis" use). */
  const [exportOpen, setExportOpen] = useState(false);
  const [printTile, setPrintTile] = useState<ParsedTile | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);

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
      if (tile) (out as Record<string, typeof tile.proposal>)[face] = rotateTrace(tile.proposal, rotations[face] ?? 0);
    }
    return out;
  }, [assignments, rotations, faceNames, tileByName]);

  // Cleanup runs on the already-lofted field, deferred so dragging a slider
  // stays smooth while the (heavier) clean + remesh catches up behind it.
  const deferredCleanup = useDeferredValue(cleanup);
  const deferredSwapped = useDeferredValue(swapped);
  const deferredPlates = useDeferredValue(plates);
  // loft -> swap -> plates -> cleanup, so the plate side always means the final foam / void.
  const built = useMemo(() => {
    if (!raw) return null;
    const lofted = deferredSwapped ? swapFoamVoid(raw.volume) : raw.volume;
    const plated = applyPlates(lofted, deferredPlates, raw.shape, TILE_FT[0]);
    const { volume, stats } = cleanupVolumeField(plated.volume, deferredCleanup, TILE_FT[0]);
    return { group: buildTileScene(volume.field, volume.resolution, TILE_FT, raw.shape), stats, plateStats: plated.stats };
  }, [raw, deferredCleanup, deferredSwapped, deferredPlates]);
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
      rotations: raw.rotations,
      cleanup: deferredCleanup,
      swapped: deferredSwapped,
      plates: arePlatesActive(deferredPlates) ? deferredPlates : undefined,
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
    }, 1800); // wait for edits to settle: each thumbnail is a GLB export + a render
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [raw, built, deferredCleanup, deferredSwapped, deferredPlates, name, saveCube]);

  const generateFrom = (shapeNow: VolumeShape, traces: VolumeAssignments, names: Record<string, string>, seedNow: number, fitNow: number, rotationsNow: Record<string, number>, reuse?: { id: string; createdAt: number }) => {
    const volume = buildVolumeField(traces, shapeNow, seedNow, fitNow, 46);
    setFaceFit(volume.faceFit);
    setAssignedFaceCount(Object.keys(traces).length);
    rawCounter.current += 1;
    // Pressing Generate again on a recipe that is already saved reuses that
    // saved piece instead of adding a duplicate.
    const fresh = freshCubeStamp();
    const same = reuse ?? cubes.find((c) => c.shape === shapeNow && c.seed === seedNow && c.fitTolerance === fitNow && JSON.stringify(c.assignments) === JSON.stringify(names) && JSON.stringify(c.rotations ?? {}) === JSON.stringify(rotationsNow));
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
      rotations: rotationsNow,
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
    generateFrom(shape, volAssignments, Object.fromEntries(Object.entries(assignments).filter(([, v]) => v)) as Record<string, string>, BUILD_SEED, BUILD_FIT_TOLERANCE, activeRotations());
  };

  /** Quarter turns for the faces that actually have a tile. */
  const activeRotations = (): Record<string, number> => Object.fromEntries(faceNames.filter((f) => assignments[f] && rotations[f]).map((f) => [f, rotations[f] as number]));

  /** A new, sensibly matched set (tile + quarter turn) for every unlocked face; locked faces stay. */
  const autoFillFaces = () => {
    if (!poolTiles.length) {
      toast.error("No tiles to pick from.");
      return;
    }
    const current: Partial<Record<VolumeFaceName, { tile: string; turns: number }>> = {};
    for (const f of faceNames) if (assignments[f]) current[f] = { tile: assignments[f]!, turns: rotations[f] ?? 0 };
    const fills = autoFill(faceNames, shape, poolTiles.map((t) => ({ name: t.name, proposal: t.proposal })), current, locks);
    setAssignments((prev) => {
      const next = { ...prev };
      for (const f of faceNames) if (!locks[f] && fills[f]) next[f] = fills[f]!.tile;
      return next;
    });
    setRotations((prev) => {
      const next = { ...prev };
      for (const f of faceNames) if (!locks[f] && fills[f]) next[f] = fills[f]!.turns;
      return next;
    });
  };

  const loadCube = (cube: SavedCube) => {
    setShape(cube.shape);
    setAssignments(cube.assignments);
    setCleanup(cube.cleanup);
    setSwapped(cube.swapped);
    setRotations(cube.rotations ?? {});
    setLocks({});
    setPlates(cube.plates ?? defaultPlates());
    setName(cube.name);
    setClip(defaultClipState());
    setOpenFace(null);
    setFaceOverlays({});
    // Lofted straight from the traces stored with the piece, so it comes back
    // exactly as it was made.
    generateFrom(cube.shape, cube.traces, cube.assignments, cube.seed, cube.fitTolerance, cube.rotations ?? {}, { id: cube.id, createdAt: cube.createdAt });
    toast.success(`Opened "${cube.name}".`);
  };

  const buildInput = (): BuildSectionTileInput => ({
    name: name.trim(),
    shape,
    assignments: volAssignments,
    assignmentNames: assignments,
    seed: raw?.seed ?? BUILD_SEED,
    fitTolerance: raw?.fitTolerance ?? BUILD_FIT_TOLERANCE,
    cleanup,
    swapped,
    plates,
    rotations: activeRotations(),
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

  const openPrint = async () => {
    if (!Object.keys(volAssignments).length) {
      toast.error("Assign at least one tile to a face first.");
      return;
    }
    setPreparingPrint(true);
    try {
      setPrintTile(await buildSectionTile({ ...buildInput(), name: name.trim() || "section_tile" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build this tile for printing.");
    } finally {
      setPreparingPrint(false);
    }
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

  useShortcuts("sections", [
    { keys: "G", label: "Generate", group: "Builder", run: generatePreview },
    { keys: "F", label: "Auto-fill faces", group: "Builder", run: autoFillFaces },
  ]);

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
                    setRotations({});
                    setLocks({});
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
          <Section
            id="builder.faces"
            title="Faces"
            summary={`${assignedFaceCount} set`}
            action={
              <Button size="sm" variant="outline" onClick={autoFillFaces} title="A new, sensibly matched set for every unlocked face -- press again for another">
                Auto-fill
              </Button>
            }
          >
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
                    setRotations((prev) => ({ ...prev, [face]: 0 }));
                    setOpenFace(null);
                  }}
                  turns={rotations[face] ?? 0}
                  onRotate={() => setRotations((prev) => ({ ...prev, [face]: ((prev[face] ?? 0) + 1) % 4 }))}
                  locked={!!locks[face]}
                  onLock={() => setLocks((prev) => ({ ...prev, [face]: !prev[face] }))}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {shape === "cube" ? `${cubeFaces.length} faces` : `${prismFaces.length} faces (6 sides + top/bottom)`} · tap a face to pick its tile, ↻ turns it 90°, the lock keeps it through Auto-fill.
            </p>
          </Section>
        </GlowPanel>
        <GlowPanel glow="orange">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Display</div>
            <DisplayModeBar mode={displayMode} onChange={setDisplayMode} modes={[{ key: "rendered", label: "Rendered" }, { key: "ghosted", label: "Ghosted" }, { key: "faces", label: "Faces" }]} />
          </div>
        </GlowPanel>
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Foam &amp; void</div>
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
        <GlowPanel glow="orange">
          <Section
            id="builder.plates"
            title="Floor plates"
            defaultOpen={false}
            summary={plates.enabled ? `${plates.count} plate${plates.count === 1 ? "" : "s"}` : "off"}
            action={
              <>
                {plates.enabled && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPlates({ ...defaultPlates(), enabled: true })}>
                    Reset
                  </Button>
                )}
                <Switch checked={plates.enabled} onCheckedChange={(enabled) => setPlates((p) => ({ ...p, enabled }))} />
              </>
            }
          >
            {!plates.enabled ? (
              <p className="text-[11px] text-muted-foreground">Off: the tile is exactly your lofted shape. Turn on to add flat floors at set heights, eroded to keep vertical connections.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Plates are made of</div>
                  <Segmented
                    value={plates.side}
                    options={[
                      { value: "foam", label: "Foam" },
                      { value: "void", label: "Void" },
                    ]}
                    onChange={(side) => setPlates((p) => ({ ...p, side }))}
                  />
                  <p className="text-[10px] text-muted-foreground">The final foam or void, whatever Swap foam &amp; void is set to.</p>
                </div>
                <NumberSlider label="Number of plates" value={plates.count} min={1} max={6} onChange={(count) => setPlates((p) => ({ ...p, count }))} />
                <NumberSlider label="First plate (top surface)" value={plates.firstElevationFt} min={1} max={20} step={0.5} decimals={1} suffix=" ft" exact onChange={(firstElevationFt) => setPlates((p) => ({ ...p, firstElevationFt }))} />
                <NumberSlider label="Floor to floor" value={plates.floorToFloorFt} min={3} max={20} step={0.5} decimals={1} suffix=" ft" exact onChange={(floorToFloorFt) => setPlates((p) => ({ ...p, floorToFloorFt }))} />
                <NumberSlider label="Thickness" value={plates.thicknessFt} min={1} max={4} step={0.25} decimals={2} suffix=" ft" exact onChange={(thicknessFt) => setPlates((p) => ({ ...p, thicknessFt }))} />
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Footprint</span>
                  <Select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={plates.footprint} onChange={(e) => setPlates((p) => ({ ...p, footprint: e.target.value as PlateFootprint }))}>
                    <option value="full">Full tile</option>
                    <option value="inset">Pulled in from the walls</option>
                    <option value="L">L figure</option>
                    <option value="T">T figure</option>
                    <option value="plus">Plus figure</option>
                  </Select>
                </label>
                {plates.footprint !== "full" && <NumberSlider label="Pull in from walls" value={plates.insetFt} min={0} max={8} step={0.25} decimals={2} suffix=" ft" exact onChange={(insetFt) => setPlates((p) => ({ ...p, insetFt }))} />}
                <Section id="builder.plates.erosion" variant="inline" title="Openings & erosion" defaultOpen={false}>
                  <NumberSlider label="Recede from surroundings" value={plates.erodePct} min={0} max={100} suffix="%" onChange={(erodePct) => setPlates((p) => ({ ...p, erodePct }))} />
                  <NumberSlider label="Random erosion" value={plates.noisePct} min={0} max={100} suffix="%" onChange={(noisePct) => setPlates((p) => ({ ...p, noisePct }))} />
                  <NumberSlider label="Opening size" value={plates.openingPct} min={0} max={80} suffix="% of width" onChange={(openingPct) => setPlates((p) => ({ ...p, openingPct }))} />
                  <label className="block text-xs">
                    Erosion seed
                    <div className="mt-1 flex gap-1.5">
                      <Input type="number" value={plates.seed} onChange={(e) => setPlates((p) => ({ ...p, seed: Number(e.target.value) || 0 }))} className="h-8" />
                      <ShuffleSeedButton onShuffle={(v) => setPlates((p) => ({ ...p, seed: v }))} />
                    </div>
                  </label>
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      Keep a vertical connection
                      <span className="block text-[10px] text-muted-foreground">Every plate keeps at least one opening, placed where a void runs through it.</span>
                    </span>
                    <Switch checked={plates.keepConnection} onCheckedChange={(keepConnection) => setPlates((p) => ({ ...p, keepConnection }))} />
                  </label>
                </Section>
                <p className="text-[11px] text-muted-foreground">
                  {built && arePlatesActive(deferredPlates)
                    ? `${built.plateStats.elevations.length} plate${built.plateStats.elevations.length === 1 ? "" : "s"} at ${built.plateStats.elevations.join(", ")} ft · ${built.plateStats.withOpenings} with openings`
                    : "Generate a preview to see them."}
                </p>
              </>
            )}
          </Section>
        </GlowPanel>
        <GlowPanel glow="magenta">
          <Section
            id="builder.cleanup"
            title="Cleanup"
            defaultOpen={false}
            summary={isCleanupActive(cleanup) ? "on" : "off"}
            action={
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!isCleanupActive(cleanup)} onClick={() => setCleanup(defaultCleanup)}>
                Reset
              </Button>
            }
          >
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
          </Section>
        </GlowPanel>
        {savedCubes.length > 0 && (
          <GlowPanel glow="orange">
            <Section id="builder.saved" title={`Saved objects (${savedCubes.length})`}>
              <p className="text-[10px] text-muted-foreground">Every piece you generate is kept with this project code automatically.</p>
              <div className="space-y-1">
                {savedCubes.map((c) => (
                  <div key={c.id} className="flex items-center gap-1 rounded-md border border-input pr-1 transition-colors hover:border-magenta/50">
                    <button onClick={() => loadCube(c)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs">
                      <span className="relative inline-block h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                        {c.plates?.enabled && <span className="absolute bottom-0 right-0 rounded-tl bg-magenta/80 px-1 font-mono text-[8px] leading-tight text-white" title={`${c.plates.count} floor plate(s), ${c.plates.side} side`}>▤{c.plates.count}</span>}
                        {c.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumb} alt="" className="h-full w-full object-contain" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {c.shape}
                          {c.swapped ? " · swapped" : ""}
                          {c.plates?.enabled ? ` · ${c.plates.count} plate${c.plates.count === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                    </button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground" aria-label={`Delete ${c.name}`} title="Delete this saved object" onClick={() => removeCube(c.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          </GlowPanel>
        )}
      </div>

      <div className="order-1 min-w-0 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-2 lg:min-h-0">
        <div className="flex h-[44vh] flex-col lg:h-full">
          <div className="min-h-0 flex-1">
          <SquareFrame className="relative">
            {busy && <LoadingCover label="Building the tile…" />}
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
                  <color attach="background" args={["#000000"]} />
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
                  <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate={autoRotate} autoRotateSpeed={60 / Math.max(rotateSecs, 1)} />
                  <CaptureBridge handleRef={viewportHandle} />
                </Canvas>
              </div>
            ) : (
              <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">
                Assign tiles to faces, then Generate preview{savedCubes.length ? " -- or open one of your saved objects." : "."}
              </div>
            )}
          </SquareFrame>
          </div>
          {raw && <ViewportTools handleRef={viewportHandle} name={name.trim() || "cube-builder"} autoRotate={autoRotate} onAutoRotate={setAutoRotate} rotateSecs={rotateSecs} onRotateSecs={setRotateSecs} />}
        </div>
      </div>

      <div className="order-3 flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
        <GlowPanel glow="orange">
          <Section id="builder.look" title="Look" defaultOpen={false} bodyClassName="space-y-4">
            <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
            <ClippingPlaneControl value={clip} onChange={setClip} />
            {displayMode === "faces" && (
              <Section id="builder.markers" variant="inline" title="Face markers" defaultOpen={false}>
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
              </Section>
            )}
          </Section>
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
              <Select className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="">—</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
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
            <Button className="w-full" variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              Export…
            </Button>
          </div>
        </GlowPanel>
      </div>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Export {name.trim() || "this object"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Button className="w-full justify-start" variant="outline" size="sm" onClick={exportObj}>
              OBJ model
            </Button>
            <Button className="w-full justify-start" variant="outline" size="sm" disabled={exportingAnalysis} onClick={() => void exportAnalysisBundle()}>
              {exportingAnalysis ? "Building…" : "_analysis folder (for the Viewer and Analysis)"}
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              size="sm"
              disabled={preparingPrint}
              onClick={async () => {
                await openPrint();
                setExportOpen(false);
              }}
            >
              {preparingPrint ? "Building…" : "STL for printing (parts and scale)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!printTile} onOpenChange={(open) => !open && setPrintTile(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Print {printTile?.name}</DialogTitle>
          </DialogHeader>
          {printTile && <PrintPanel tile={printTile} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
