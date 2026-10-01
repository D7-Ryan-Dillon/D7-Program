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
import { useProject } from "@/lib/project-store";
import type { BankTile } from "@/lib/sections/tileLibrary";
import { cubeFaces, facesForShape, prismFaces, type VolumeAssignments, type VolumeFaceName, type VolumeShape } from "@/lib/sections/volumeField";
import { voxelizeVolumeField } from "@/lib/sections/voxelize";
import { buildVolumeField } from "@/lib/sections/volumeField";
import { buildTileScene } from "@/lib/sections/mesh";
import { buildSectionTile } from "@/lib/sections/buildTile";
import type { ParsedTile } from "@/lib/types";

const CATEGORY_OPTIONS = ["gathering", "office", "lobby"] as const;

// Same material convention as ThreeViewport's applyMaterial: always
// double-sided (a lofted/blended field can fold into thin branching sheets,
// not just chunky solids, and a single-sided material shows through to
// nothing on their backfaces), transparent+dim when ghosted.
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

function PreviewScene({ group, displayMode, visibility, colors }: { group: THREE.Group; displayMode: DisplayMode; visibility: MeshVisibility; colors: MeshColors }) {
  useEffect(() => {
    const ghosted = displayMode === "ghosted";
    applyPreviewMaterial(group.getObjectByName("foam"), colors.foam, visibility.foam, ghosted);
    applyPreviewMaterial(group.getObjectByName("void"), colors.void, visibility.void, ghosted);
  }, [group, displayMode, visibility, colors]);
  return <primitive object={group} />;
}

export function CubeHexBuilder({ bankTiles, onSaved }: { bankTiles: BankTile[]; onSaved: (tile: ParsedTile) => void }) {
  const { addTile } = useProject();
  const [shape, setShape] = useState<VolumeShape>("cube");
  const [assignments, setAssignments] = useState<Partial<Record<VolumeFaceName, string>>>({});
  const [fitTolerance, setFitTolerance] = useState(50);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number] | "">("");
  const [typology, setTypology] = useState("");
  const [previewGroup, setPreviewGroup] = useState<THREE.Group | null>(null);
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("rendered");
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: true });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });
  const [busy, setBusy] = useState(false);

  const faceNames = facesForShape(shape);
  const tileByName = useMemo(() => new Map(bankTiles.map((t) => [t.name, t])), [bankTiles]);

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
    const volume = buildVolumeField(volAssignments, shape, fitTolerance, 46);
    const voxels = voxelizeVolumeField(volume);
    if (!voxels.material || !voxels.voidSmooth) return;
    setFaceFit(volume.faceFit);
    setPreviewGroup(buildTileScene(voxels.material, voxels.voidSmooth));
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
      const tile = await buildSectionTile({
        name: name.trim(),
        shape,
        assignments: volAssignments,
        fitTolerance,
        guessed: category ? { category, typology: typology.trim() || undefined } : {},
      });
      addTile(tile);
      onSaved(tile);
      toast.success(`Saved "${tile.name}" to the tile bank`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build this tile.");
    } finally {
      setBusy(false);
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
                <Button key={s} size="sm" variant={shape === s ? "default" : "outline"} className="flex-1" onClick={() => { setShape(s); setAssignments({}); setPreviewGroup(null); }}>
                  {s === "cube" ? "Cube" : "Hex prism"}
                </Button>
              ))}
            </div>
          </div>
        </GlowPanel>
        <GlowPanel glow="orange">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Faces</div>
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
                      {t.name}
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
            <DisplayModeBar mode={displayMode} onChange={setDisplayMode} />
          </div>
        </GlowPanel>
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Merge settings</div>
            <label className="block text-xs">
              Merge smoothness ({fitTolerance})
              <input type="range" min={0} max={100} value={fitTolerance} onChange={(e) => setFitTolerance(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <p className="text-[11px] text-muted-foreground">How rounded the seam is where each face&rsquo;s mass merges into the others -- 0 is a sharp union, 100 is very rounded.</p>
            <Button className="w-full" onClick={generatePreview}>
              Generate preview
            </Button>
            {faceFit !== null && <p className="text-[11px] text-muted-foreground">Face fit: {faceFit}% (how much of each drawn mass survived the merge unchanged)</p>}
          </div>
        </GlowPanel>
      </div>

      <div className="min-h-0 min-w-0">
        <SquareFrame className="relative">
          {previewGroup ? (
            <div className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
              <Canvas dpr={[1, 2]} camera={{ fov: 45, position: [15, 12, 15] }} gl={{ antialias: true }}>
                <color attach="background" args={["#0a0a0b"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[10, 16, 8]} intensity={1.1} />
                <directionalLight position={[-8, -6, -8]} intensity={0.25} />
                <Bounds key={previewGroup.uuid} fit clip observe margin={1.3}>
                  <PreviewScene group={previewGroup} displayMode={displayMode} visibility={visibility} colors={colors} />
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
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Save as tile</div>
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
              {busy ? "Building…" : "Save as tile"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Builds the real voxels/mesh/metrics (same step as Generate preview, run fresh) and adds it to this project&rsquo;s tile bank -- usable in Viewer and Analysis right away.
            </p>
          </div>
        </GlowPanel>
      </div>
    </div>
  );
}
