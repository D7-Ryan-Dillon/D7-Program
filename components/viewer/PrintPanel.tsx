"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PRINT_SCALES, usePrintRatio } from "@/components/viewer/SpacesPanel";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { availableParts, buildStl, DETAIL_CHOICES, filamentMetres, STL_PARTS, type PrintDetail, type StlPart, type StlResult } from "@/lib/exporters/stl";
import type { ParsedTile } from "@/lib/types";

/** Print-ready STL: choose the parts and the scale, see the printed size, volume and warnings, then download. */
export function PrintPanel({ tile }: { tile: ParsedTile }) {
  const [ratio, setRatio] = usePrintRatio();
  const [parts, setParts] = useState<StlPart[]>(["foam"]);
  const [merge, setMerge] = useState(false);
  const [mode, setMode] = useState<"preset" | "ratio" | "size">("preset");
  const [targetMm, setTargetMm] = useState(50);
  const [detail, setDetail] = useState<PrintDetail>(3);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ key: string; result: StlResult } | null>(null);
  const offered = useMemo(() => availableParts(tile), [tile]);
  // the numbers belong to one tile, scale and choice of parts: change any and they are gone
  const key = `${tile.id}|${ratio}|${parts.join("+")}|${merge}|${detail}`;
  const result = done && done.key === key ? done.result : null;

  const mm = 304.8 / ratio;
  const toggle = (p: StlPart) => setParts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const run = async (download: boolean) => {
    if (!parts.length) {
      toast.error("Pick at least one part.");
      return;
    }
    setBusy(true);
    try {
      const res = await buildStl(tile, parts, ratio, merge, detail);
      setDone({ key, result: res });
      if (download) for (const f of res.files) downloadBlob(f.name, f.blob);
      if (download && !res.files.length) toast.error("Nothing to write: the tile has none of those parts.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the STL.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Mesh detail</div>
        <Select className="h-7 text-[11px]" value={String(detail)} onChange={(e) => setDetail(Number(e.target.value) as PrintDetail)} aria-label="Mesh detail">
          {DETAIL_CHOICES.map((d) => (
            <option key={d.value} value={String(d.value)}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Parts</div>
        {STL_PARTS.filter((p) => offered.includes(p.key)).map((p) => (
          <label key={p.key} className="flex items-start gap-2 text-xs" title={p.hint}>
            <input type="checkbox" className="mt-0.5" checked={parts.includes(p.key)} onChange={() => toggle(p.key)} />
            <span>
              {p.label}
              <span className="block text-[10px] text-muted-foreground">{p.hint}</span>
            </span>
          </label>
        ))}
        {parts.length > 1 && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            One merged file (default: one file per part)
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Scale</div>
        <Select
          className="h-7 text-[11px]"
          value={mode === "preset" ? String(ratio) : mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "ratio" || v === "size") setMode(v);
            else {
              setMode("preset");
              setRatio(Number(v));
            }
          }}
          aria-label="Print scale"
        >
          {PRINT_SCALES.map((s) => (
            <option key={s.ratio} value={s.ratio}>
              {s.label}
            </option>
          ))}
          <option value="ratio">Custom ratio</option>
          <option value="size">Target size (mm)</option>
        </Select>
        {mode === "ratio" && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">1 :</span>
            <input
              type="number"
              min={10}
              max={2000}
              value={Math.round(ratio)}
              onChange={(e) => setRatio(Math.max(10, Number(e.target.value) || 120))}
              className="h-7 w-24 rounded-md border border-input bg-transparent px-2 font-mono text-xs"
            />
          </label>
        )}
        {mode === "size" && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Width</span>
            <input
              type="number"
              min={5}
              max={600}
              value={targetMm}
              onChange={(e) => {
                const v = Math.max(5, Number(e.target.value) || 50);
                setTargetMm(v);
                setRatio((tile.tileFt[0] * 304.8) / v);
              }}
              className="h-7 w-24 rounded-md border border-input bg-transparent px-2 font-mono text-xs"
            />
            <span className="text-muted-foreground">mm</span>
          </label>
        )}
        <p className="text-[11px] text-muted-foreground">
          Printed {(tile.tileFt[0] * mm).toFixed(0)} x {(tile.tileFt[1] * mm).toFixed(0)} x {(tile.tileFt[2] * mm).toFixed(0)} mm (1 ft = {mm.toFixed(2)} mm). Binary STL, millimetres, Z up.
        </p>
      </div>

      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={busy || !parts.length} onClick={() => void run(true)}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Building..." : parts.length > 1 && !merge ? `Download ${parts.length} STLs` : "Download STL"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || !parts.length} onClick={() => void run(false)} className="text-muted-foreground">
          Check only
        </Button>
      </div>

      {result && (
        <div className="space-y-1 rounded-md border-hair p-2 text-[11px]">
          {result.perPart.map((p) => (
            <div key={p.part} className="flex items-baseline justify-between gap-2">
              <span className="uppercase tracking-label text-muted-foreground">{p.part}</span>
              <span className="font-mono">
                {p.volumeCm3.toFixed(1)} cm³ · {p.triangles.toLocaleString()} tris
                {p.part === "foam" ? ` · ~${filamentMetres(p.volumeCm3, 0.2).toFixed(1)} m at 20% fill` : ""}
              </span>
            </div>
          ))}
          {result.warnings.map((w) => (
            <div key={w} className="text-orange">
              {w}
            </div>
          ))}
          {!result.warnings.length && <div className="text-muted-foreground">Meshes are watertight.</div>}
        </div>
      )}
    </div>
  );
}
