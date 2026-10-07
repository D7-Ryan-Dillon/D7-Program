"use client";

import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { tileGroup } from "@/components/shared/TileSwitcher";
import { PRINT_SCALES } from "@/components/viewer/SpacesPanel";
import { useProject } from "@/lib/project-store";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { availableParts, binaryStl, DETAIL_CHOICES, STL_PARTS, tileTriangles, type PrintDetail, type StlPart } from "@/lib/exporters/stl";
import { fineSoup } from "@/lib/exporters/printMesh";
import { buildLabelledBlock, findLabelPatch, labelFor, lowered, lowestZ, subFor } from "@/lib/exporters/printLabels";
import { cn } from "@/lib/utils";
import type { ParsedTile } from "@/lib/types";

const GROUPS = [
  ["all", "All"],
  ["gathering", "Gathering"],
  ["office", "Workspace"],
  ["lobby", "Lobby"],
  ["builder", "Cube builder"],
  ["assembly", "Assemblies"],
  ["other", "Other"],
] as const;

const BED_MM = 250; // the P1S plate is 256 x 256 mm; leave a margin

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.+-]+/g, "_") || "block";

const README = `HOW TO LOAD THESE IN BAMBU STUDIO (P1S + AMS)

Each folder is one block:
  <label>_block.stl   the block, with a pocket cut into its underside
  <label>_label.stl   the label that exactly fills the pocket
  <label>_void.stl, _plates.stl, _struts.stl   other parts, if you ticked them

1. Drag BOTH files of a block into Bambu Studio together.
2. When it asks "Load these files as a single object with multiple parts?", choose YES.
3. In the object list you now have one object with two parts. Right-click each part and give it a filament:
   the label gets the label colour, the block gets the block colour.
4. The label sits on the plate, flush in the underside, so it is only the first layers of the print.
   Slice as usual. Nothing needs to be flipped: the underside is already on the plate.

The text is mirrored in the file on purpose, so it reads correctly when you look at the underside of the printed block.

If Bambu Studio offers to repair the mesh around the label (tiny seams left by the cut), accept: it does not change the shape.
`;

/** Prints several blocks at once: pick tiles from the bank, a scale and the parts, and each block comes out with a label sunk flush into its underside as a second part (for AMS colour). One zip, one folder per block. */
export function PrintBatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tiles } = useProject();
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  /** the optional second line (smaller, under the label) per block; empty = none */
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"scale" | "size">("scale");
  const [ratio, setRatio] = useState(120);
  const [sizeMm, setSizeMm] = useState(100);
  const [parts, setParts] = useState<Record<StlPart, boolean>>({ foam: true, void: false, plates: false, struts: false });
  const [labelOn, setLabelOn] = useState(true);
  const [depth, setDepth] = useState("0.6");
  const [height, setHeight] = useState("6");
  const [detail, setDetail] = useState<PrintDetail>(3);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  const present = GROUPS.filter(([k]) => k === "all" || tiles.some((t) => tileGroup(t) === k));
  const shown = tiles.filter((t) => group === "all" || tileGroup(t) === group);
  const subOf = (t: ParsedTile) => (subs[t.id] ?? "").trim() || undefined;
  const labelOf = (t: ParsedTile, i: number) => (labels[t.id] ?? labelFor(t.name, i)).trim() || labelFor(t.name, i);
  const ratioFor = (t: ParsedTile) => (mode === "scale" ? ratio : (Math.max(...t.tileFt) * 304.8) / sizeMm);

  const rows = useMemo(
    () =>
      tiles.map((t, i) => {
        const r = mode === "scale" ? ratio : (Math.max(...t.tileFt) * 304.8) / sizeMm;
        const mm = 304.8 / r;
        const text = (labels[t.id] ?? labelFor(t.name, i)).trim() || labelFor(t.name, i);
        const found = findLabelPatch(t, r, { text, depthMm: Number(depth), maxHeightMm: Number(height), sub: (subs[t.id] ?? "").trim() || undefined });
        return { t, i, size: t.tileFt.map((v) => v * mm) as [number, number, number], found };
      }),
    [tiles, mode, ratio, sizeMm, labels, subs, depth, height],
  );
  const chosen = rows.filter((r) => picked.has(r.t.id));
  const anyPart = (Object.values(parts) as boolean[]).some(Boolean);

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const allShown = shown.length > 0 && shown.every((t) => picked.has(t.id));

  const run = async () => {
    if (!chosen.length || !anyPart) return;
    setBusy(true);
    setNotes([]);
    abort.current = new AbortController();
    const out: string[] = [];
    try {
      const zip = new JSZip();
      zip.file("README.txt", README);
      let done = 0;
      for (const { t, i } of chosen) {
        if (abort.current.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const text = labelOf(t, i);
        const r = ratioFor(t);
        const folder = zip.folder(safe(text))!;
        setProgress({ label: `${text}: building`, done, total: chosen.length });
        const offered = availableParts(t);
        const want = (Object.keys(parts) as StlPart[]).filter((p) => parts[p] && offered.includes(p));
        if (!want.length) {
          out.push(`${text}: none of the chosen parts exist on this tile.`);
          done++;
          continue;
        }
        // every part of a block is lowered by the same amount, so they stay in register and the foam's underside is on the plate
        let zShift = 0;
        let labelled = false;
        if (want.includes("foam") && labelOn) {
          setProgress({ label: `${text}: cutting the label pocket`, done, total: chosen.length });
          await new Promise((res) => setTimeout(res, 30));
          const res = await buildLabelledBlock(t, r, { text, depthMm: Number(depth), maxHeightMm: Number(height), sub: subOf(t) }, detail);
          if (!("error" in res)) {
            zShift = res.zShift;
            labelled = true;
            folder.file(`${safe(text)}_block.stl`, binaryStl([res.block], "block with label pocket").blob);
            folder.file(`${safe(text)}_label.stl`, binaryStl([res.label], "label").blob);
            for (const w of res.warnings) out.push(`${text}: ${w}`);
          } else out.push(`${text}: no label (${res.error}); the block is exported plain.`);
        }
        for (const part of want) {
          if (part === "foam" && labelled) continue;
          const url = part === "plates" || part === "struts" ? t.partsUrl : t.glbUrl;
          if (!url) continue;
          const fine = detail && (part === "foam" || part === "void") ? fineSoup(t, r, detail, part) : null;
          await new Promise((res) => setTimeout(res, 0));
          const v = fine ?? (await tileTriangles(t, url, part, r)).v;
          if (!v.length) continue;
          if (part === "foam" && !zShift) zShift = lowestZ(v);
          folder.file(`${safe(text)}_${part === "foam" ? "block" : part}.stl`, binaryStl([lowered(v, zShift)], part).blob);
        }
        done++;
        setProgress({ label: `${text}: done`, done, total: chosen.length });
      }
      downloadBlob(`print_${chosen.length}_blocks.zip`, await zip.generateAsync({ type: "blob" }));
      toast.success(`Saved ${chosen.length} block${chosen.length === 1 ? "" : "s"} in one zip.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : "Couldn't build the print files.");
    } finally {
      setNotes(out);
      setProgress(null);
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>3D print: several blocks, labelled</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground">
          Each block gets a label sunk flush into its underside as a separate part, so the label prints first, face down on the plate, with the block above it. Load a block&apos;s two files together in Bambu Studio and give each part its own filament.
        </p>

        <div className="grid gap-4 md:grid-cols-[1.25fr_1fr]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {present.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setGroup(k)} className={cn("rounded-full border-hair px-2.5 py-1 font-mono text-[10px] uppercase tracking-label transition-colors", group === k ? "border-magenta/50 bg-magenta/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => setPicked((p) => (allShown ? new Set([...p].filter((id) => !shown.some((t) => t.id === id))) : new Set([...p, ...shown.map((t) => t.id)])))} className="ml-auto font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground">
                {allShown ? "Clear these" : "Select these"}
              </button>
            </div>
            <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
              {rows
                .filter((r) => group === "all" || tileGroup(r.t) === group)
                .map((r) => {
                  const on = picked.has(r.t.id);
                  const tooBig = r.size[0] > BED_MM || r.size[1] > BED_MM;
                  return (
                    <div key={r.t.id} className={cn("flex items-center gap-2 rounded-md border-hair px-2 py-1.5 text-xs", on && "border-magenta/50 bg-magenta/10")}>
                      <input type="checkbox" className="accent-[var(--magenta)]" checked={on} onChange={() => toggle(r.t.id)} aria-label={`Print ${r.t.name}`} />
                      <TileThumbnail glbUrl={r.t.glbUrl} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{r.t.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.size.map((v) => v.toFixed(0)).join(" × ")} mm
                          {tooBig && <span className="ml-1 text-orange">· too big for the plate</span>}
                          {labelOn && "error" in r.found && <span className="ml-1 text-orange">· no room for a label</span>}
                          {labelOn && "patch" in r.found && <span className="ml-1">· letters {r.found.patch.textHeightMm.toFixed(1)} mm</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <input
                          value={labels[r.t.id] ?? labelFor(r.t.name, r.i)}
                          onChange={(e) => setLabels((l) => ({ ...l, [r.t.id]: e.target.value.slice(0, 8) }))}
                          aria-label={`Label for ${r.t.name}`}
                          disabled={!labelOn}
                          className="h-7 w-28 rounded-md border border-input bg-transparent px-1.5 text-center font-mono text-[11px] outline-none focus-visible:border-ring disabled:opacity-40"
                        />
                        <input
                          value={subs[r.t.id] ?? ""}
                          onChange={(e) => setSubs((l) => ({ ...l, [r.t.id]: e.target.value.slice(0, 24) }))}
                          placeholder="2nd line"
                          aria-label={`Second line under the label for ${r.t.name}`}
                          disabled={!labelOn}
                          className="h-6 w-28 rounded-md border border-input bg-transparent px-1.5 text-center font-mono text-[10px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring disabled:opacity-40"
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Size</div>
              <Select className="h-7 text-[11px]" value={mode} onChange={(e) => setMode(e.target.value as "scale" | "size")} aria-label="How to size the blocks">
                <option value="scale">The same scale for every block</option>
                <option value="size">The same longest side for every block</option>
              </Select>
              {mode === "scale" ? (
                <Select className="h-7 text-[11px]" value={String(ratio)} onChange={(e) => setRatio(Number(e.target.value))} aria-label="Print scale">
                  {PRINT_SCALES.map((s) => (
                    <option key={s.ratio} value={s.ratio}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  Longest side
                  <input type="number" min={20} max={250} value={sizeMm} onChange={(e) => setSizeMm(Math.max(20, Math.min(250, Number(e.target.value) || 100)))} className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right font-mono text-[11px] outline-none focus-visible:border-ring" />
                  mm
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Mesh detail</div>
              <Select className="h-7 text-[11px]" value={String(detail)} onChange={(e) => setDetail(Number(e.target.value) as PrintDetail)} aria-label="Mesh detail">
                {DETAIL_CHOICES.map((d) => (
                  <option key={d.value} value={String(d.value)}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <p className="text-[10px] text-muted-foreground">The surface is rebuilt smooth from the tile&apos;s voxels, so the print has no grid facets.</p>
            </div>

            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Parts to print</div>
              {STL_PARTS.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-xs" title={p.hint}>
                  <input type="checkbox" className="mt-0.5 accent-[var(--magenta)]" checked={parts[p.key]} onChange={(e) => setParts((s) => ({ ...s, [p.key]: e.target.checked }))} />
                  <span>
                    {p.label}
                    <span className="block text-[10px] text-muted-foreground">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center justify-between text-xs">
                <span>
                  Label on the underside
                  <span className="block text-[10px] text-muted-foreground">goes on the foam block, flush, on the plate</span>
                </span>
                <Switch checked={labelOn} onCheckedChange={setLabelOn} />
              </label>
              {labelOn && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5 text-[10px] text-muted-foreground">
                    Depth
                    <Select className="h-7 text-[11px]" value={depth} onChange={(e) => setDepth(e.target.value)} aria-label="Label depth">
                      <option value="0.4">0.4 mm (2 layers)</option>
                      <option value="0.5">0.5 mm</option>
                      <option value="0.6">0.6 mm (3 layers)</option>
                      <option value="0.8">0.8 mm (4 layers)</option>
                    </Select>
                  </label>
                  <label className="space-y-0.5 text-[10px] text-muted-foreground">
                    Tallest letters
                    <Select className="h-7 text-[11px]" value={height} onChange={(e) => setHeight(e.target.value)} aria-label="Letter height">
                      {[4, 5, 6, 8, 10].map((h) => (
                        <option key={h} value={String(h)}>
                          {h} mm
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="col-span-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>Second line: type a smaller line under the label on any block (for example “void field” under G-2).</span>
                    <span className="flex shrink-0 gap-2">
                      <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setSubs(Object.fromEntries(tiles.map((t) => [t.id, subFor(t)])))}>
                        Name the types
                      </button>
                      <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setSubs({})}>
                        Clear
                      </button>
                    </span>
                  </div>
                  {Number(depth) === 0.5 && <p className="col-span-2 text-[10px] text-orange">0.5 mm is two and a half layers at 0.2 mm; the slicer will round it. 0.6 mm is three clean layers.</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-md border-hair p-2">
            {notes.map((n, i) => (
              <p key={i} className="text-[10px] text-orange">
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
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy || !chosen.length || !anyPart} onClick={() => void run()}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {chosen.length ? `Export ${chosen.length} block${chosen.length === 1 ? "" : "s"}` : "Pick blocks to export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
