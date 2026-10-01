"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { SquareFrame } from "@/components/shared/SquareFrame";
import { useProject } from "@/lib/project-store";
import type { BankTile } from "@/lib/sections/tileLibrary";
import { cubeFaces, facesForShape, prismFaces, type VolumeAssignments, type VolumeFaceName, type VolumeShape } from "@/lib/sections/volumeField";
import { voxelizeVolumeField } from "@/lib/sections/voxelize";
import { buildVolumeField } from "@/lib/sections/volumeField";
import { buildTileScene } from "@/lib/sections/mesh";
import { buildSectionTile } from "@/lib/sections/buildTile";
import type { ParsedTile } from "@/lib/types";

const CATEGORY_OPTIONS = ["gathering", "office", "lobby"] as const;

function PreviewScene({ group, foamVisible, voidVisible }: { group: THREE.Group; foamVisible: boolean; voidVisible: boolean }) {
  useEffect(() => {
    const foam = group.getObjectByName("foam");
    const voidMesh = group.getObjectByName("void");
    if (foam) foam.visible = foamVisible;
    if (voidMesh) voidMesh.visible = voidVisible;
  }, [group, foamVisible, voidVisible]);
  return <primitive object={group} />;
}

export function CubeHexBuilder({ bankTiles, onSaved }: { bankTiles: BankTile[]; onSaved: (tile: ParsedTile) => void }) {
  const { addTile } = useProject();
  const [shape, setShape] = useState<VolumeShape>("cube");
  const [assignments, setAssignments] = useState<Partial<Record<VolumeFaceName, string>>>({});
  const [seed, setSeed] = useState(1);
  const [fitTolerance, setFitTolerance] = useState(50);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number] | "">("");
  const [typology, setTypology] = useState("");
  const [previewGroup, setPreviewGroup] = useState<THREE.Group | null>(null);
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const [foamVisible, setFoamVisible] = useState(true);
  const [voidVisible, setVoidVisible] = useState(true);
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
    const volume = buildVolumeField(volAssignments, shape, seed, fitTolerance, 46);
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
        seed,
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
        <GlowPanel glow="magenta">
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Loft settings</div>
            <label className="block text-xs">
              Seed
              <Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="mt-1 h-8" />
            </label>
            <label className="block text-xs">
              Seam fit tolerance ({fitTolerance})
              <input type="range" min={0} max={100} value={fitTolerance} onChange={(e) => setFitTolerance(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <Button className="w-full" onClick={generatePreview}>
              Generate preview
            </Button>
            {faceFit !== null && <p className="text-[11px] text-muted-foreground">Face fit: {faceFit}% (how much of each drawn trace survived the loft unchanged)</p>}
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
                  <PreviewScene group={previewGroup} foamVisible={foamVisible} voidVisible={voidVisible} />
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
          <div className="space-y-3 p-4">
            <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Visibility</div>
            <div className="flex items-center justify-between text-xs">
              <span>Foam</span>
              <Switch checked={foamVisible} onCheckedChange={setFoamVisible} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Void</span>
              <Switch checked={voidVisible} onCheckedChange={setVoidVisible} />
            </div>
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
