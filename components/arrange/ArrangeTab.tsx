"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { useProject, useProjectUi } from "@/lib/project-store";
import { useUiField } from "@/lib/useUiField";
import { ViewportTools } from "@/components/shared/ViewportTools";
import type { ViewportHandle } from "@/lib/viewportCapture";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Section } from "@/components/shared/Section";
import { BankPanel } from "@/components/arrange/BankPanel";
import { SettingsPanel } from "@/components/arrange/SettingsPanel";
import { JointsPanel } from "@/components/arrange/JointsPanel";
import { InstanceEditor } from "@/components/arrange/InstanceEditor";
import { InstanceList } from "@/components/arrange/InstanceList";
import { ArrangeViewport, instanceMatrix } from "@/components/arrange/ArrangeViewport";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import { autoGenerate, regenerateMarked } from "@/lib/arrange/autoGenerate";
import { aggregateScore } from "@/lib/arrange/joints";
import { snapToNearest } from "@/lib/arrange/snap";
import { DEFAULT_SETTINGS, type Assembly, type AutoGenerateSettings, type PlacedInstance } from "@/lib/arrange/types";
import type { ParsedTile } from "@/lib/types";
import { buildManifestText } from "@/lib/exporters/recipeManifest";
import { downloadTextFile, groupToObjText } from "@/lib/exporters/objExport";
import { fuseAssembly } from "@/lib/exporters/csgFuse";
import * as THREE from "three";

/** What the Arrange tab remembers per project (the generated arrangement itself is cheap to regrow and is not saved). */
interface ArrangeUi {
  selected: string[];
  settings: AutoGenerateSettings;
  visibility: MeshVisibility;
  colors: MeshColors;
  autoRotate: boolean;
  rotateSecs: number;
}
const defaultArrangeUi = (): ArrangeUi => ({
  selected: [],
  settings: DEFAULT_SETTINGS,
  visibility: { foam: true, void: true },
  colors: { foam: "#e8a6c8", void: "#1c1c1f" },
  autoRotate: false,
  rotateSecs: 24,
});

export function ArrangeTab() {
  const { tiles } = useProject();
  const [aui, setAui] = useProjectUi<ArrangeUi>("arrange", defaultArrangeUi);
  const selected = useMemo(() => new Set(aui.selected), [aui.selected]);
  const setSelected = (next: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setAui((prev) => {
      const resolved = typeof next === "function" ? next(new Set(prev.selected)) : next;
      return { ...prev, selected: [...resolved] };
    });
  const [settings, setSettings] = useUiField(aui, setAui, "settings");
  const [visibility, setVisibility] = useUiField(aui, setAui, "visibility");
  const [colors, setColors] = useUiField(aui, setAui, "colors");
  const [autoRotate, setAutoRotate] = useUiField(aui, setAui, "autoRotate");
  const [rotateSecs, setRotateSecs] = useUiField(aui, setAui, "rotateSecs");
  const viewportHandle = useRef<ViewportHandle | null>(null);
  const [assembly, setAssembly] = useState<Assembly>({ instances: [], joints: [] });
  const [fused, setFused] = useState(false);
  const [fusedMesh, setFusedMesh] = useState<THREE.Mesh | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenNonce, setRegenNonce] = useState(0);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[] | null>(null);

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const bankTiles = useMemo(() => tiles.filter((t) => selected.has(t.id)), [tiles, selected]);
  const overallScore = useMemo(() => aggregateScore(assembly.joints.map((j) => j.score)), [assembly]);
  const selectedInstance = assembly.instances.find((inst) => inst.id === selectedInstanceId) ?? null;

  const toggleBank = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllBank = (ids: string[]) => {
    setSelected(new Set(ids));
  };

  const generate = () => {
    if (!bankTiles.length) {
      toast.error("Check at least one tile in the bank first.");
      return;
    }
    setFused(false);
    setFusedMesh(null);
    setSelectedInstanceId(null);
    setSelectedJointId(null);
    setHighlightIds(null);
    setRegenNonce((n) => n + 1);
    setAssembly(autoGenerate(bankTiles, settings));
  };

  const rateJoint = (jointId: string, rating: "good" | "bad" | null) => {
    setAssembly((prev) => ({ ...prev, joints: prev.joints.map((j) => (j.id === jointId ? { ...j, rating } : j)) }));
  };

  const selectJoint = (jointId: string) => {
    const joint = assembly.joints.find((j) => j.id === jointId);
    if (!joint) return;
    setSelectedJointId(jointId);
    setSelectedInstanceId(joint.bId);
    setHighlightIds([joint.aId, joint.bId]);
  };

  // A plain instance selection (viewport click, or the placed-pieces list)
  // isn't about a joint -- clears any leftover highlight from a previous
  // joint-row click rather than leaving it stale on the new selection.
  const selectInstance = (id: string | null) => {
    setSelectedInstanceId(id);
    setSelectedJointId(null);
    setHighlightIds(null);
  };

  const updateInstance = (id: string, patch: Partial<PlacedInstance>) => {
    setAssembly((prev) => ({ ...prev, instances: prev.instances.map((inst) => (inst.id === id ? { ...inst, ...patch } : inst)) }));
    setFused(false);
    setFusedMesh(null);
  };

  const removeInstance = (id: string) => {
    setAssembly((prev) => ({
      instances: prev.instances.filter((inst) => inst.id !== id),
      joints: prev.joints.filter((j) => j.aId !== id && j.bId !== id),
    }));
    setFused(false);
    setFusedMesh(null);
    setSelectedInstanceId((prev) => (prev === id ? null : prev));
    setHighlightIds(null);
  };

  const snapInstance = (id: string) => {
    const target = assembly.instances.find((inst) => inst.id === id);
    const targetTile = target && tileById.get(target.tileId);
    if (!target || !targetTile) return;
    const others = assembly.instances
      .filter((inst) => inst.id !== id)
      .map((inst) => ({ instance: inst, tile: tileById.get(inst.tileId) }))
      .filter((o): o is { instance: PlacedInstance; tile: ParsedTile } => !!o.tile);
    const posFt = snapToNearest(target, targetTile, others);
    if (posFt) updateInstance(id, { posFt });
  };

  const regenerate = () => {
    const badIds = new Set(assembly.joints.filter((j) => j.rating === "bad").map((j) => j.id));
    if (!badIds.size || !bankTiles.length) return;
    const nonce = regenNonce + 1;
    setRegenNonce(nonce);
    setFused(false);
    setFusedMesh(null);
    setSelectedInstanceId(null);
    setSelectedJointId(null);
    setHighlightIds(null);
    setAssembly(regenerateMarked(assembly, bankTiles, badIds, settings, nonce));
  };

  const exportManifest = () => {
    downloadTextFile("assembly.recipe-sheet.txt", buildManifestText(assembly, tiles));
  };

  const exportObj = async () => {
    if (fusedMesh) {
      downloadTextFile("assembly.obj", groupToObjText(fusedMesh));
      return;
    }
    setBusy(true);
    try {
      const group = new THREE.Group();
      const loader = new (await import("three/examples/jsm/loaders/GLTFLoader.js")).GLTFLoader();
      for (const inst of assembly.instances) {
        const tile = tileById.get(inst.tileId);
        if (!tile) continue;
        const gltf = await loader.loadAsync(tile.glbUrl);
        const scene = gltf.scene.clone(true);
        const foam = scene.getObjectByName("foam");
        const voidMesh = scene.getObjectByName("void");
        if (foam) foam.visible = visibility.foam;
        if (voidMesh) voidMesh.visible = visibility.void;
        const m = instanceMatrix(tile.tileFt, inst.mirror, inst.rotZ, inst.posFt, inst.scale, inst.tilt);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        m.decompose(p, q, s);
        scene.position.copy(p);
        scene.quaternion.copy(q);
        scene.scale.copy(s);
        group.add(scene);
      }
      group.updateMatrixWorld(true);
      downloadTextFile("assembly.obj", groupToObjText(group));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export the assembly.");
    } finally {
      setBusy(false);
    }
  };

  const toggleFuse = async () => {
    if (fused) {
      setFused(false);
      setFusedMesh(null);
      return;
    }
    setBusy(true);
    try {
      const meshNames: ("foam" | "void")[] = [
        ...(visibility.foam ? (["foam"] as const) : []),
        ...(visibility.void ? (["void"] as const) : []),
      ];
      const mesh = await fuseAssembly(assembly.instances, tileById, meshNames);
      setFusedMesh(mesh);
      setFused(true);
      toast.success("Fused into one solid");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fuse failed — this is a known rough edge, try again or export unfused for now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)]">
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
          <GlowPanel glow="magenta">
            <Section id="arrange.bank" title="Bank" summary={`${selected.size} checked`}>
              <BankPanel selected={selected} onToggle={toggleBank} onSelectAll={selectAllBank} />
            </Section>
          </GlowPanel>
          <GlowPanel glow="orange">
            <Section id="arrange.generate" title="Auto-generate">
              <SettingsPanel settings={settings} onChange={setSettings} onGenerate={generate} disabled={!bankTiles.length} />
            </Section>
          </GlowPanel>
        </div>

        {/* Pinned to the top on phones / half-screen laptops while the controls scroll underneath. */}
        <div className="order-1 flex min-w-0 flex-col gap-3 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-none lg:min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-xs text-muted-foreground">
              {assembly.instances.length} piece(s)
              {overallScore !== null && <span className="ml-2 text-foreground">· overall {overallScore.toFixed(0)}</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Smooth &amp; seal</span>
              <Switch checked={fused} disabled={busy || !assembly.instances.length} onCheckedChange={() => void toggleFuse()} />
            </div>
          </div>
          <div className="flex h-[40vh] min-w-0 flex-col lg:h-auto lg:min-h-0 lg:flex-1">
            <div className="relative min-h-0 flex-1">
            {assembly.instances.length ? (
              <ArrangeViewport
                autoRotate={autoRotate}
                autoRotateSpeed={60 / Math.max(rotateSecs, 1)}
                handleRef={viewportHandle}
                fitKey={regenNonce}
                instances={assembly.instances}
                tileById={tileById}
                visibility={visibility}
                colors={colors}
                fusedMesh={fusedMesh}
                selectedId={selectedInstanceId}
                highlightIds={highlightIds}
                onSelect={selectInstance}
              />
            ) : (
              <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">
                Check tiles in the Bank, set Amount, then Auto-generate.
              </div>
            )}
            </div>
            {assembly.instances.length > 0 && <ViewportTools handleRef={viewportHandle} name="arrangement" autoRotate={autoRotate} onAutoRotate={setAutoRotate} rotateSecs={rotateSecs} onRotateSecs={setRotateSecs} />}
          </div>
        </div>

        <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
          <GlowPanel glow="magenta">
            <Section id="arrange.visibility" title="Visibility" defaultOpen={false}>
              <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
            </Section>
          </GlowPanel>
          <GlowPanel glow="orange">
            <Section id="arrange.joints" title="Joints" defaultOpen={false} summary={`${assembly.joints.length}`}>
              <JointsPanel joints={assembly.joints} selectedJointId={selectedJointId} onRate={rateJoint} onSelect={selectJoint} onRegenerate={regenerate} />
            </Section>
          </GlowPanel>
          <GlowPanel glow="magenta">
            <Section id="arrange.selected" title="Selected piece">
              <InstanceEditor instance={selectedInstance} tile={selectedInstance ? tileById.get(selectedInstance.tileId) : undefined} onUpdate={updateInstance} onRemove={removeInstance} onSnap={snapInstance} />
            </Section>
          </GlowPanel>
          <GlowPanel glow="orange">
            <Section id="arrange.placed" title="Placed pieces" defaultOpen={false} summary={`${assembly.instances.length}`}>
              <InstanceList instances={assembly.instances} tileById={tileById} selectedId={selectedInstanceId} onSelect={selectInstance} />
            </Section>
          </GlowPanel>
          <GlowPanel glow="magenta">
            <Section id="arrange.export" title="Export">
              <Button variant="outline" size="sm" className="w-full justify-start" disabled={!assembly.instances.length} onClick={exportManifest}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Recipe rebuild sheet
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" disabled={!assembly.instances.length || busy} onClick={() => void exportObj()}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download .obj
              </Button>
            </Section>
          </GlowPanel>
        </div>
      </div>
    </div>
  );
}
