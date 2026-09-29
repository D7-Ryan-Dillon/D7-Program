"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Layers } from "lucide-react";
import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BankPanel } from "@/components/arrange/BankPanel";
import { SettingsPanel } from "@/components/arrange/SettingsPanel";
import { JointsPanel } from "@/components/arrange/JointsPanel";
import { ArrangeViewport, instanceMatrix } from "@/components/arrange/ArrangeViewport";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import { autoGenerate, regenerateMarked } from "@/lib/arrange/autoGenerate";
import { aggregateScore } from "@/lib/arrange/joints";
import { DEFAULT_SETTINGS, type Assembly } from "@/lib/arrange/types";
import { buildManifestText } from "@/lib/exporters/recipeManifest";
import { downloadTextFile, groupToObjText } from "@/lib/exporters/objExport";
import { fuseAssembly } from "@/lib/exporters/csgFuse";
import * as THREE from "three";

export function ArrangeTab() {
  const { tiles } = useProject();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [assembly, setAssembly] = useState<Assembly>({ instances: [], joints: [] });
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: true });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });
  const [fused, setFused] = useState(false);
  const [fusedMesh, setFusedMesh] = useState<THREE.Mesh | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenNonce, setRegenNonce] = useState(0);

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const bankTiles = useMemo(() => tiles.filter((t) => selected.has(t.id)), [tiles, selected]);
  const overallScore = useMemo(() => aggregateScore(assembly.joints.map((j) => j.score)), [assembly]);

  const toggleBank = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = () => {
    if (!bankTiles.length) {
      toast.error("Check at least one tile in the bank first.");
      return;
    }
    setFused(false);
    setFusedMesh(null);
    setAssembly(autoGenerate(bankTiles, settings));
  };

  const rateJoint = (jointId: string, rating: "good" | "bad" | null) => {
    setAssembly((prev) => ({ ...prev, joints: prev.joints.map((j) => (j.id === jointId ? { ...j, rating } : j)) }));
  };

  const regenerate = () => {
    const badIds = new Set(assembly.joints.filter((j) => j.rating === "bad").map((j) => j.id));
    if (!badIds.size || !bankTiles.length) return;
    const nonce = regenNonce + 1;
    setRegenNonce(nonce);
    setFused(false);
    setFusedMesh(null);
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
        const m = instanceMatrix(tile.tileFt, inst.mirror, inst.rot, inst.pos);
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
    <div className="flex h-full flex-col gap-4">
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_280px]">
        <div className="flex flex-col gap-4">
          <GlowPanel glow="magenta">
            <div className="p-4">
              <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Bank</div>
              <BankPanel selected={selected} onToggle={toggleBank} />
            </div>
          </GlowPanel>
          <GlowPanel glow="orange">
            <div className="p-4">
              <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Auto-generate</div>
              <SettingsPanel settings={settings} onChange={setSettings} onGenerate={generate} disabled={!bankTiles.length} />
            </div>
          </GlowPanel>
        </div>

        <div className="flex min-h-[420px] flex-col gap-3">
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
          <div className="min-h-0 flex-1">
            {assembly.instances.length ? (
              <ArrangeViewport instances={assembly.instances} tileById={tileById} visibility={visibility} colors={colors} fusedMesh={fusedMesh} />
            ) : (
              <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">
                Check tiles in the Bank, set Amount, then Auto-generate.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <GlowPanel glow="magenta">
            <div className="p-4">
              <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Visibility</div>
              <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
            </div>
          </GlowPanel>
          <GlowPanel glow="orange">
            <div className="p-4">
              <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Joints</div>
              <JointsPanel joints={assembly.joints} onRate={rateJoint} onRegenerate={regenerate} />
            </div>
          </GlowPanel>
          <GlowPanel glow="magenta">
            <div className="space-y-2 p-4">
              <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Export</div>
              <Button variant="outline" size="sm" className="w-full justify-start" disabled={!assembly.instances.length} onClick={exportManifest}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Recipe rebuild sheet
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" disabled={!assembly.instances.length || busy} onClick={() => void exportObj()}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download .obj
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" disabled>
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                .3dm — via Grasshopper
              </Button>
            </div>
          </GlowPanel>
        </div>
      </div>
    </div>
  );
}
