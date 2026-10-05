"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import * as THREE from "three";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SizeFields } from "@/components/shared/SizeFields";
import type { ParsedTile } from "@/lib/types";
import { groupToObjText } from "@/lib/exporters/objExport";
import { buildStl, STL_PARTS, availableParts, type StlPart } from "@/lib/exporters/stl";
import { buildManifestText } from "@/lib/exporters/recipeManifest";
import { buildDrawing } from "@/lib/drawing/build";
import { drawingSet } from "@/lib/drawing/exportSet";
import { drawingStyle, drawingToPng } from "@/lib/drawing/render";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { encodeGif } from "@/lib/boards/gifExport";
import { encodeMp4, mp4Supported } from "@/lib/boards/mp4Export";
import { defaultAnimationSettings } from "@/lib/boards/types";
import { buildComposite, compositeMeshes, compositeToTile } from "@/lib/arrange/composite";
import { smoothComposite } from "@/lib/arrange/smooth";
import { glbToFt, pieceMatrix } from "@/lib/arrange/placement";
import { fineGeometry, QUALITY_CHOICES, refineByTileId, type Quality } from "@/lib/fineGeometry";
import { buildRhinoZip } from "@/lib/arrange/exportRhino";
import { buildReport } from "@/lib/arrange/report";
import { applyTourLook, capturePosePng, createPoseAnimation, toScene, type PoseFt } from "@/lib/arrange/capture";
import { findNiceViews } from "@/lib/arrange/views";
import { planDrone, type DronePlan } from "@/lib/arrange/drone";
import { namesFor } from "@/lib/arrange/whole";
import { CATEGORY_LABEL } from "@/lib/arrange/types";
import { categoryOf } from "@/lib/arrange/orient";
import { useArrange } from "@/components/arrange/useArrange";
import { cn } from "@/lib/utils";

type Key = "stl" | "obj" | "plans" | "report" | "png" | "views" | "drone" | "buildup" | "rhino" | "sheet";
interface Out {
  name: string;
  blob: Blob;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.+-]+/g, "_") || "arrangement";
const text = (s: string, type = "text/plain") => new Blob([s], { type });

/** Turns the camera about the vertical axis through its target. */
function orbitPose(base: PoseFt, deg: number): PoseFt {
  const a = (deg * Math.PI) / 180;
  const dx = base.pos[0] - base.target[0];
  const dy = base.pos[1] - base.target[1];
  return { ...base, pos: [base.target[0] + dx * Math.cos(a) - dy * Math.sin(a), base.target[1] + dx * Math.sin(a) + dy * Math.cos(a), base.pos[2]] };
}

function Row({ id, label, hint, on, set, children, disabled }: { id: string; label: string; hint: string; on: boolean; set: (v: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn("rounded-md border-hair px-3 py-2", on && "border-magenta/40 bg-magenta/5", disabled && "opacity-50")}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
        <input id={id} type="checkbox" disabled={disabled} className="mt-0.5 accent-[var(--magenta)]" checked={on} onChange={(e) => set(e.target.checked)} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-foreground">{label}</span>
          <span className="block text-[10px] text-muted-foreground">{hint}</span>
        </span>
      </label>
      {on && children && <div className="mt-2 space-y-2 border-t border-border pt-2 pl-6">{children}</div>}
    </div>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <div className="pt-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground">{children}</div>;

/** One window for everything the arrangement can become. Tick what you want, press Export: one file, or one zip when there are several. */
export function ExportDialog({ open, onOpenChange, onPreviewTour }: { open: boolean; onOpenChange: (o: boolean) => void; onPreviewTour: (plan: DronePlan, seconds: number) => void }) {
  const A = useArrange();
  const [sel, setSel] = useState<Record<Key, boolean>>({ stl: false, obj: false, plans: false, report: false, png: false, views: false, drone: false, buildup: false, rhino: false, sheet: false });
  const [stl, setStl] = useState({ ratio: "120", merge: false, parts: { foam: true, void: false, plates: false, struts: false } as Record<StlPart, boolean> });
  const [plans, setPlans] = useState<"png" | "svg">("png");
  const [pic, setPic] = useState({ w: 1920, h: 1080, clear: false });
  const [plansCfg, setPlansCfg] = useState({ dpi: 150, ftPerIn: 10 });
  const [rep, setRep] = useState({ scale: 1 });
  const [drone, setDrone] = useState({ kind: "full" as "full" | "highlights", spaces: 4, approach: true, seconds: 0, fps: 24, width: 1280, height: 720, fov: 78, format: "mp4" as "mp4" | "gif" });
  const [build, setBuild] = useState({ seconds: 10, fps: 20, width: 1280, height: 720, format: "mp4" as "mp4" | "gif" });
  const [quality, setQuality] = useState<Quality>(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [note, setNote] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const tileCache = useRef<{ key: string; tile: ParsedTile } | null>(null);
  const planCache = useRef<{ key: unknown; plan: DronePlan | null } | null>(null);

  const name = safe(A.ui.currentName);
  const none = !A.layout.boxes.length;
  const ok = A.valid;
  const mp4 = mp4Supported();
  const count = (Object.values(sel) as boolean[]).filter(Boolean).length;
  const toggle = (k: Key) => (v: boolean) => setSel((s) => ({ ...s, [k]: v }));
  const formats = [
    { v: "mp4", l: mp4 ? "MP4" : "MP4 (not in this browser)" },
    { v: "gif", l: "GIF" },
  ];

  const buildTile = async (): Promise<ParsedTile> => {
    const key = JSON.stringify([A.doc, A.ui.smoothOn, A.ui.smooth, A.doc.names]);
    if (tileCache.current?.key === key) return tileCache.current.tile;
    let comp = buildComposite(A.layout.boxes);
    if (!comp) throw new Error("Nothing to export.");
    if (A.ui.smoothOn) comp = smoothComposite(comp, A.layout.joints, A.ui.smooth).comp;
    const tile = await compositeToTile(comp, A.layout.boxes, { name: A.ui.currentName, doc: { ...A.doc, names: namesFor(A.doc, A.autoName) }, withMeshes: true });
    tileCache.current = { key, tile };
    return tile;
  };

  /** The drone's flight, planned once per arrangement (and per field of view). */
  const getPlan = async (): Promise<DronePlan> => {
    const comp = A.whole.comp;
    if (!comp) throw new Error("The building is still being read: try again in a moment.");
    const key = [comp, A.entrance, A.sequence.steps.map((s) => s.pieceId).join(), drone.fov, drone.kind, drone.spaces, drone.approach];
    const c = planCache.current;
    if (c && (c.key as unknown[]).every((v, i) => v === key[i])) {
      if (c.plan) return c.plan;
      throw new Error("There is no way through this arrangement wide enough for the drone.");
    }
    await new Promise((r) => setTimeout(r, 20));
    const plan = planDrone(comp, { order: A.sequence.steps.map((s) => s.pieceId), entrance: A.entrance, fov: drone.fov, highlights: drone.kind === "highlights" ? drone.spaces : undefined, approach: drone.approach });
    planCache.current = { key, plan };
    if (!plan) throw new Error("There is no way through this arrangement wide enough for the drone.");
    return plan;
  };
  const droneSeconds = (plan: DronePlan | null) => {
    if (drone.seconds > 0) return drone.seconds;
    if (drone.kind === "highlights") return plan ? Math.min(40, Math.max(10, Math.round(plan.lengthFt / 9))) : 20;
    return plan ? Math.min(120, Math.max(20, Math.round(plan.lengthFt / 7))) : 30;
  };

  const [plan, setPlan] = useState<DronePlan | null>(null);
  const previewTour = async () => {
    setBusy("plan");
    try {
      const p = await getPlan();
      setPlan(p);
      onOpenChange(false);
      onPreviewTour(p, droneSeconds(p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't plan the tour.");
    } finally {
      setBusy(null);
    }
  };

  const film = async (kind: "drone" | "buildup"): Promise<Out> => {
    const h = A.viewportHandle.current;
    if (!h) throw new Error("The viewport isn't ready yet.");
    const cfg = kind === "drone" ? drone : build;
    let flight: DronePlan | null = null;
    if (kind === "drone") {
      setProgress({ label: "planning the flight", done: 0, total: 1 });
      flight = await getPlan();
      setPlan(flight);
    }
    const seconds = kind === "drone" ? droneSeconds(flight) : build.seconds;
    const frames = Math.max(8, Math.round(seconds * cfg.fps));
    const width = cfg.width;
    const height = cfg.height;
    abort.current = new AbortController();
    let source: ReturnType<typeof createPoseAnimation> | null = null;
    let look: ReturnType<typeof applyTourLook> | null = null;
    try {
      const snap = h.snapshot();
      if (!snap) throw new Error("The viewport isn't ready yet.");
      if (kind === "drone") {
        look = applyTourLook(snap.scene);
        const light = look.light;
        source = createPoseAnimation(
          h,
          (i, n) => {
            const p = flight!.pose(i / Math.max(1, n - 1));
            light.position.copy(toScene(p.pos));
            return p;
          },
          frames,
          { width, height, background: "#000000" },
        );
      } else {
        const base = A.viewportApi.current?.getPose();
        if (!base) throw new Error("The viewport isn't ready yet.");
        const order = A.sequence.steps.map((s) => s.pieceId).concat(A.layout.boxes.map((b) => b.piece.id).filter((id) => !A.sequence.steps.some((s) => s.pieceId === id)));
        const names = order.map((id) => `piece-${id}`);
        const hide = (visibleCount: number) =>
          names.forEach((n, i) => {
            const o = snap.scene.getObjectByName(n);
            if (o) o.visible = i < visibleCount;
          });
        source = createPoseAnimation(h, (i, n) => orbitPose(base, (120 * i) / n), frames, { width, height, background: "#000000" }, {
          before: (i) => hide(Math.max(1, Math.ceil(((i + 1) / (frames * 0.75)) * names.length))),
          after: () => hide(names.length),
        });
      }
      const settings = { ...defaultAnimationSettings(), fps: cfg.fps, widthPx: width };
      const blob =
        cfg.format === "mp4"
          ? await encodeMp4(source, cfg.fps, (done, total) => setProgress({ label: kind === "drone" ? "recording the tour" : "recording the build-up", done, total }), abort.current.signal)
          : (await encodeGif(source, settings, (phase, done, total) => setProgress({ label: phase === "palette" ? "choosing colours" : "encoding frames", done, total }), abort.current.signal)).blob;
      return { name: `${name}_${kind === "drone" ? "drone_tour" : "build_up"}.${cfg.format}`, blob };
    } finally {
      source?.dispose();
      look?.restore();
      abort.current = null;
    }
  };

  /** Runs a render with the smooth, high-detail meshes swapped into the live scene, then puts the light ones back. */
  const withFine = async <T,>(f: () => Promise<T>): Promise<T> => {
    const snap = A.viewportHandle.current?.snapshot();
    const restore = snap && quality ? refineByTileId(snap.scene, A.tileById, quality) : () => {};
    try {
      await new Promise((r) => setTimeout(r, 30));
      return await f();
    } finally {
      restore();
    }
  };

  const make = async (k: Key): Promise<Out[]> => {
    const h = A.viewportHandle.current;
    const pose = A.viewportApi.current?.getPose();
    switch (k) {
      case "stl": {
        const tile = await buildTile();
        const avail = availableParts(tile);
        const want = (Object.keys(stl.parts) as StlPart[]).filter((p) => stl.parts[p] && avail.includes(p));
        if (!want.length) throw new Error("STL: pick at least one part that this arrangement has.");
        const r = await buildStl(tile, want, Number(stl.ratio), stl.merge);
        setNote([`printed size ${r.sizeMm.map((v) => v.toFixed(0)).join(" × ")} mm`, ...r.warnings]);
        return r.files.map((f) => ({ name: f.name, blob: f.blob }));
      }
      case "obj": {
        const comp = buildComposite(A.layout.boxes)!;
        const m = compositeMeshes(A.ui.smoothOn ? smoothComposite(comp, A.layout.joints, A.ui.smooth).comp : comp, 1);
        const g = new THREE.Group();
        const wholeFrame = glbToFt({ schema: "erosion-tile/4", engineVersion: "arrange" } as ParsedTile);
        if (A.ui.smoothOn || !quality) for (const c of m.main.children) g.add(c.clone());
        else
          // each piece's foam and void rebuilt smooth from its voxels, placed where the piece is (a mirrored piece's triangles are turned back outward)
          for (const b of A.layout.boxes) {
            const mat = pieceMatrix(b.tile, b.piece);
            const flip = mat.determinant() < 0;
            for (const solid of ["foam", "void"] as const) {
              const geo = fineGeometry(b.tile, solid, quality)?.clone();
              if (!geo) continue;
              geo.applyMatrix4(mat);
              if (flip) {
                const idx = geo.getIndex()!;
                for (let i = 0; i < idx.count; i += 3) {
                  const a = idx.getY(i);
                  idx.setY(i, idx.getZ(i));
                  idx.setZ(i, a);
                }
              }
              const mesh = new THREE.Mesh(geo);
              mesh.name = `${solid}_${b.piece.id}`;
              g.add(mesh);
            }
          }
        const parts = new THREE.Group();
        for (const c of m.parts?.children ?? []) parts.add(c.clone());
        parts.applyMatrix4(wholeFrame);
        if (A.ui.smoothOn || !quality) g.applyMatrix4(wholeFrame);
        g.add(parts);
        g.updateMatrixWorld(true);
        return [{ name: `${name}.obj`, blob: text(groupToObjText(g)) }];
      }
      case "plans": {
        const tile = await buildTile();
        const out: Out[] = [];
        if (plans === "svg") for (const f of drawingSet(tile)) out.push({ name: `drawings/${f.path.replace("vector/drawings/", "")}`, blob: text(f.svg, "image/svg+xml") });
        else {
          const style = drawingStyle("dark");
          for (const lv of tile.spaces?.levels ?? []) {
            const d = buildDrawing(tile, { kind: "plan", level: lv.id });
            if (d) out.push({ name: `drawings/plan_level_${String(lv.id).padStart(2, "0")}.png`, blob: await drawingToPng(d, style, { feetPerInch: plansCfg.ftPerIn, dpi: plansCfg.dpi }) });
          }
          for (const axis of ["x", "y"] as const)
            for (const frac of [0.25, 0.5, 0.75]) {
              const span = tile.tileFt[axis === "x" ? 0 : 1];
              const d = buildDrawing(tile, { kind: "section", axis, positionFt: span * frac });
              if (d) out.push({ name: `drawings/section_${axis}_${Math.round(span * frac)}ft.png`, blob: await drawingToPng(d, style, { feetPerInch: plansCfg.ftPerIn, dpi: plansCfg.dpi }) });
            }
        }
        return out;
      }
      case "report": {
        const picture = h && pose ? await capturePosePng(h, pose, { width: Math.round(1520 * rep.scale), height: Math.round(940 * rep.scale), background: "#000000" }) : null;
        const seq = A.sequence.steps.map((s) => ({ name: A.nameOf(s.pieceId), category: CATEGORY_LABEL[categoryOf(A.layout.byId.get(s.pieceId)!.tile)], score: s.joint?.score ?? null }));
        return [{ name: `${name}_report.png`, blob: await buildReport({ scale: rep.scale, title: A.ui.currentName, picture, summary: A.whole.summary, sequence: seq, joints: A.joints, warnings: A.warnings, names: A.nameOf }) }];
      }
      case "png": {
        if (!h || !pose) throw new Error("The viewport isn't ready yet.");
        const w = pic.w;
        const hh = pic.h;
        return [{ name: `${name}_view.png`, blob: await capturePosePng(h, pose, { width: w, height: hh, background: "#000000", transparent: pic.clear }) }];
      }
      case "views": {
        if (!h) throw new Error("The viewport isn't ready yet.");
        const w = pic.w;
        const hh = pic.h;
        const found = findNiceViews(A.layout.boxes, { comp: A.whole.comp, route: null, entrance: A.entrance });
        const out: Out[] = [];
        for (const [i, v] of found.entries()) out.push({ name: `views/${name}_view${i + 1}_${v.kind}.png`, blob: await capturePosePng(h, v.pose, { width: w, height: hh, background: "#000000", transparent: pic.clear }) });
        return out;
      }
      case "drone":
        return [await film("drone")];
      case "buildup":
        return [await film("buildup")];
      case "rhino": {
        const comp = buildComposite(A.layout.boxes)!;
        const r = await buildRhinoZip(A.ui.smoothOn ? smoothComposite(comp, A.layout.joints, A.ui.smooth).comp : comp, A.ui.currentName);
        return [{ name: `${name}_for_rhino.zip`, blob: r.blob }];
      }
      case "sheet":
        return [{ name: `${name}.rebuild-sheet.txt`, blob: text(buildManifestText(A.doc, A.joints, A.tiles, A.nameOf)) }];
    }
  };

  const run = async () => {
    if (none) return;
    if (!ok) {
      toast.error("Exports need a connected arrangement: fix the disconnected or overlapping pieces first (see Info → Overview).");
      A.setHighlight(new Set([...A.layout.islands.flat(), ...A.layout.overlaps.flat()]));
      return;
    }
    const keys = (Object.keys(sel) as Key[]).filter((k) => sel[k]);
    if (!keys.length) return;
    setBusy("export");
    setNote([]);
    try {
      const outs: Out[] = [];
      for (const k of keys) {
        setProgress({ label: `making ${k}`, done: 0, total: 1 });
        outs.push(...(await (["png", "views", "report", "drone", "buildup"].includes(k) ? withFine(() => make(k)) : make(k))));
      }
      if (outs.length === 1) downloadBlob(outs[0].name, outs[0].blob);
      else {
        const zip = new JSZip();
        for (const o of outs) zip.file(o.name, o.blob);
        downloadBlob(`${name}_export.zip`, await zip.generateAsync({ type: "blob" }));
      }
      toast.success(outs.length === 1 ? "Saved." : `Saved ${outs.length} files in one zip.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : "Couldn't export.");
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const printWarn = useMemo(() => (A.whole.summary ? A.whole.summary.checks.filter((c) => c.status !== "ok").map((c) => c.label) : []), [A.whole.summary]);
  const speed = plan ? plan.lengthFt / droneSeconds(plan) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export “{A.ui.currentName}”</DialogTitle>
        </DialogHeader>
        {!ok && !none && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">Disconnected or overlapping pieces: exports are blocked until they are fixed.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Tick only what you want. One item downloads as itself; several come in one zip.</p>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground" title="How finely the models are rebuilt for pictures, films and the OBJ. The live view keeps the light meshes.">
            Mesh quality
            <Select className="h-7 w-44 text-[11px]" value={String(quality)} onChange={(e) => setQuality(Number(e.target.value) as Quality)} aria-label="Mesh quality">
              {QUALITY_CHOICES.map((q) => (
                <option key={q.value} value={String(q.value)}>
                  {q.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="space-y-2">
          <Heading>3D models</Heading>
          <Row id="x-stl" label="STL for printing" hint="foam, void, floor plates or branches at a chosen scale" on={sel.stl} set={toggle("stl")}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {STL_PARTS.map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={p.hint}>
                  <input type="checkbox" className="accent-[var(--magenta)]" checked={stl.parts[p.key]} onChange={(e) => setStl((s) => ({ ...s, parts: { ...s.parts, [p.key]: e.target.checked } }))} />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Select className="h-7 flex-1 text-[11px]" value={stl.ratio} onChange={(e) => setStl((s) => ({ ...s, ratio: e.target.value }))} aria-label="Print scale">
                <option value="120">1 in = 10 ft (1:120)</option>
                <option value="240">1 in = 20 ft (1:240)</option>
                <option value="60">1 in = 5 ft (1:60)</option>
                <option value="480">1 in = 40 ft (1:480)</option>
              </Select>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={stl.merge} onCheckedChange={(v) => setStl((s) => ({ ...s, merge: v }))} />
                One file
              </label>
            </div>
            {printWarn.length > 0 && <p className="text-[10px] text-orange">Print checks to look at: {printWarn.join(", ")} (Info → Overview).</p>}
          </Row>
          <Row id="x-obj" label="OBJ model" hint="foam, void, plates and branches as groups" on={sel.obj} set={toggle("obj")} />

          <Heading>Drawings and report</Heading>
          <Row id="x-plans" label="Plans and sections" hint="every level, and three sections each way" on={sel.plans} set={toggle("plans")}>
            <Select className="h-7 text-[11px]" value={plans} onChange={(e) => setPlans(e.target.value as "png" | "svg")} aria-label="Drawing format">
              <option value="png">PNG (black ground)</option>
              <option value="svg">SVG (vector)</option>
            </Select>
            {plans === "png" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-0.5 text-[10px] text-muted-foreground">
                  Scale
                  <Select className="h-7 text-[11px]" value={String(plansCfg.ftPerIn)} onChange={(e) => setPlansCfg((c) => ({ ...c, ftPerIn: Number(e.target.value) }))} aria-label="Drawing scale">
                    {[5, 10, 20, 40].map((v) => (
                      <option key={v} value={String(v)}>
                        1 in = {v} ft
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-0.5 text-[10px] text-muted-foreground">
                  Resolution
                  <Select className="h-7 text-[11px]" value={String(plansCfg.dpi)} onChange={(e) => setPlansCfg((c) => ({ ...c, dpi: Number(e.target.value) }))} aria-label="Drawing resolution">
                    {[96, 150, 200, 300, 600].map((v) => (
                      <option key={v} value={String(v)}>
                        {v} dpi
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            )}
          </Row>
          <Row id="x-report" label="One-page report" hint="picture, numbers, sequence and joints as one PNG" on={sel.report} set={toggle("report")}>
            <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              Resolution
              <Select className="h-7 w-44 text-[11px]" value={String(rep.scale)} onChange={(e) => setRep({ scale: Number(e.target.value) })} aria-label="Report resolution">
                <option value="1">1× (1600 × 1000)</option>
                <option value="2">2× (3200 × 2000)</option>
                <option value="3">3× (4800 × 3000)</option>
              </Select>
            </label>
          </Row>

          <Heading>Pictures</Heading>
          <Row id="x-png" label="Picture of the current view" hint="exactly what you see, without the helper marks" on={sel.png} set={toggle("png")}>
            <div className="flex items-center gap-2">
              <div className="flex-1"><SizeFields width={pic.w} height={pic.h} onChange={(w, h) => setPic((p) => ({ ...p, w, h }))} /></div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={pic.clear} onCheckedChange={(v) => setPic((p) => ({ ...p, clear: v }))} />
                Clear background
              </label>
            </div>
          </Row>
          <Row id="x-views" label="The best views, found for you" hint="a few exterior corners and an interior view" on={sel.views} set={toggle("views")}>
            <p className="text-[10px] text-muted-foreground">Uses the size and background above (set under “Picture of the current view”, or the defaults).</p>
          </Row>

          <Heading>Films</Heading>
          <Row id="x-drone" label="Drone house tour" hint="flies in at the entrance and glides through the voids, never through a wall" on={sel.drone} set={toggle("drone")}>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-[10px] text-muted-foreground">
                Tour
                <Select
                  className="h-7 text-[11px]"
                  value={drone.kind}
                  onChange={(e) => {
                    setPlan(null);
                    setDrone((d) => ({ ...d, kind: e.target.value as "full" | "highlights", seconds: 0 }));
                  }}
                  aria-label="Kind of tour"
                >
                  <option value="full">Full: every space</option>
                  <option value="highlights">Highlights: a short tour</option>
                </Select>
              </label>
              {drone.kind === "highlights" ? (
                <label className="space-y-0.5 text-[10px] text-muted-foreground">
                  Spaces to show
                  <Select
                    className="h-7 text-[11px]"
                    value={String(drone.spaces)}
                    onChange={(e) => {
                      setPlan(null);
                      setDrone((d) => ({ ...d, spaces: Number(e.target.value) }));
                    }}
                    aria-label="Spaces to show"
                  >
                    {[2, 3, 4, 5, 6, 8].map((n) => (
                      <option key={n} value={String(n)}>
                        {n} spaces
                      </option>
                    ))}
                  </Select>
                </label>
              ) : (
                <label className="flex items-end gap-1.5 pb-1 text-[10px] text-muted-foreground">
                  <Switch
                    checked={drone.approach}
                    onCheckedChange={(v) => {
                      setPlan(null);
                      setDrone((d) => ({ ...d, approach: v }));
                    }}
                  />
                  Start outside
                </label>
              )}
            </div>
            {drone.kind === "highlights" && (
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>The way in, then the roomiest and tallest spaces, spread along the route.</span>
                <label className="flex shrink-0 items-center gap-1.5">
                  <Switch
                    checked={drone.approach}
                    onCheckedChange={(v) => {
                      setPlan(null);
                      setDrone((d) => ({ ...d, approach: v }));
                    }}
                  />
                  Start outside
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-[10px] text-muted-foreground">
                Length
                <Select className="h-7 text-[11px]" value={String(drone.seconds)} onChange={(e) => setDrone((d) => ({ ...d, seconds: Number(e.target.value) }))} aria-label="Length">
                  <option value="0">Automatic{plan ? ` (${droneSeconds(plan)} s)` : ""}</option>
                  {(drone.kind === "highlights" ? [10, 15, 20, 30, 40, 60] : [20, 30, 45, 60, 90, 120]).map((s) => (
                    <option key={s} value={String(s)}>
                      {s} s
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-0.5 text-[10px] text-muted-foreground">
                Lens
                <Select className="h-7 text-[11px]" value={String(drone.fov)} onChange={(e) => setDrone((d) => ({ ...d, fov: Number(e.target.value) }))} aria-label="Lens">
                  <option value="60">Natural (60°)</option>
                  <option value="78">Wide (78°)</option>
                  <option value="95">Ultra wide (95°)</option>
                </Select>
              </label>
            </div>
            <SizeFields width={drone.width} height={drone.height} onChange={(w, h) => setDrone((d) => ({ ...d, width: w, height: h }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select className="h-7 text-[11px]" value={String(drone.fps)} onChange={(e) => setDrone((d) => ({ ...d, fps: Number(e.target.value) }))} aria-label="Frames per second">
                {[12, 24, 30].map((f) => (
                  <option key={f} value={String(f)}>
                    {f} fps
                  </option>
                ))}
              </Select>
              
              <Select className="h-7 text-[11px]" value={drone.format} onChange={(e) => setDrone((d) => ({ ...d, format: e.target.value as "mp4" | "gif" }))} aria-label="Format">
                {formats.map((f) => (
                  <option key={f.v} value={f.v} disabled={f.v === "mp4" && !mp4}>
                    {f.l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {plan ? `${plan.lengthFt.toFixed(0)} ft of flight, ${plan.visited.length} spaces, ${speed?.toFixed(1)} ft/s, ${plan.clearanceFt} ft from every wall${plan.skipped.length ? ` · ${plan.skipped.length} too tight to enter` : ""}` : "Plans the flight when you export or preview."}
              </span>
              <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={busy !== null || none || !A.whole.comp} onClick={() => void previewTour()}>
                {busy === "plan" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                Preview
              </Button>
            </div>
          </Row>
          <Row id="x-build" label="Build-up animation" hint="the pieces arrive one by one while the camera turns" on={sel.buildup} set={toggle("buildup")}>
            <SizeFields width={build.width} height={build.height} onChange={(w, h) => setBuild((b) => ({ ...b, width: w, height: h }))} />
            <div className="grid grid-cols-3 gap-2">
              <Select className="h-7 text-[11px]" value={String(build.seconds)} onChange={(e) => setBuild((b) => ({ ...b, seconds: Number(e.target.value) }))} aria-label="Seconds">
                {[6, 10, 15, 20].map((f) => (
                  <option key={f} value={String(f)}>
                    {f} s
                  </option>
                ))}
              </Select>
              
              <Select className="h-7 text-[11px]" value={build.format} onChange={(e) => setBuild((b) => ({ ...b, format: e.target.value as "mp4" | "gif" }))} aria-label="Format">
                {formats.map((f) => (
                  <option key={f.v} value={f.v} disabled={f.v === "mp4" && !mp4}>
                    {f.l}
                  </option>
                ))}
              </Select>
            </div>
          </Row>

          <Heading>For Rhino</Heading>
          <Row id="x-rhino" label="Mass for the engine" hint="a second pass: add sources where joints dead-end, run, and drop the result into the Viewer" on={sel.rhino} set={toggle("rhino")} />
          <Row id="x-sheet" label="Rebuild sheet" hint="a text list of every piece, position and orientation, to rebuild by hand" on={sel.sheet} set={toggle("sheet")} />
        </div>

        {note.length > 0 && (
          <div className="space-y-0.5">
            {note.map((n, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">
                {n}
              </p>
            ))}
          </div>
        )}

        {progress && (
          <div className="space-y-1.5 rounded-md border-hair p-2 text-[11px]">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{progress.label}</span>
              <span className="font-mono">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-gradient-to-r from-magenta to-orange" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            </div>
            <Button size="sm" variant="outline" className="h-6" onClick={() => abort.current?.abort()}>
              <Square className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy !== null || none || count === 0} onClick={() => void run()}>
            {busy === "export" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {count === 0 ? "Tick something to export" : `Export ${count} item${count === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
