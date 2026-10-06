"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useProjectUi } from "@/lib/project-store";
import { defaultPalette } from "@/lib/boardPalette";
import { buildAssignmentSheets, defaultAssignmentTexts, type AssignmentKind, type AssignmentTexts } from "@/lib/boards/assignmentSheets";
import { downloadBlob } from "@/lib/boards/exportBoard";
import type { BoardConfig } from "@/lib/boards/types";
import { useEvaluation } from "@/lib/useEvaluation";

interface Ui {
  widthIn: number;
  heightIn: number;
  dpi: number;
  texts: AssignmentTexts;
}
const defaultUi = (): Ui => ({ widthIn: 22, heightIn: 11, dpi: 150, texts: defaultAssignmentTexts() });

const SHEETS: { kind: AssignmentKind; label: string; hint: string }[] = [
  { kind: "workflow", label: "Workflow and run logs", hint: "Your workflow text, the Versur logs you paste, and the interlock test of every tile written out as a run log" },
  { kind: "ideas", label: "4.2-4.4 Ideas by category", hint: "One page per category: each type's image, its intention, the descriptors it shows most and its criteria evaluation as bars" },
  { kind: "diagrams", label: "5.1 Diagram catalogue (3 x 5)", hint: "Plan and section of every tile, labelled with its type" },
  { kind: "geometry", label: "6.1 Geometry catalogue (3 x 5)", hint: "Every tile with an aggregation of copies (repeat, mirror or shift) that proves the interlock, its joint scores, and the Part 2 pass. Draws many 3D models: it takes a minute" },
  { kind: "criteria", label: "7.1 Selection criteria", hint: "The matrix's descriptors: carried forward or set aside and why, and how the fifteen tiles read" },
  { kind: "evaluation", label: "7.2-7.4 Evaluation by category", hint: "One page per category: the carried criteria across its five types, usable floor, fit to the type" },
  { kind: "insights", label: "8.1 Overall insights", hint: "Your text, or a first draft from the numbers if you leave it empty" },
  { kind: "references", label: "References", hint: "Your list" },
];

/**
 * The sheets Assignment 2 asks for, drawn from the program's own results (the Analysis evaluation, the Arrange interlock test), as PNGs in the size you set.
 * The pages are plain images; you place them in the presentation at whatever size your screen wants.
 */
export function AssignmentSheetsPanel({ config, dpiFromBoard }: { config: BoardConfig; dpiFromBoard: number }) {
  const ev = useEvaluation();
  const [ui, setUi] = useProjectUi<Ui>("assignmentSheets", defaultUi);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const texts = { ...defaultAssignmentTexts(), ...ui.texts };

  const run = async (kind: AssignmentKind) => {
    setBusy(kind);
    setProgress("");
    try {
      const palette = { ...defaultPalette(), bg: config.backgroundColor, accent: config.titleColor, heading: config.highlightColor, muted: config.descriptorColor };
      const sheets = await buildAssignmentSheets(kind, {
        project: config.name,
        tiles: ev.tiles,
        evals: ev.evals,
        profile: ev.profile,
        carried: ev.keys,
        reasons: ev.reasons,
        setAside: ev.setAside,
        palette,
        fontFamily: config.fontFamily,
        look: { foamColor: config.foamColor, voidColor: config.voidColor, foamOpacity: config.foamOpacity, voidOpacity: config.voidOpacity },
        texts,
        widthIn: ui.widthIn,
        heightIn: ui.heightIn,
        dpi: ui.dpi || dpiFromBoard,
        onProgress: (done, total, what) => setProgress(`${done}/${total} ${what}`),
      });
      if (!sheets.length) toast.error("Nothing to draw: the bank has no tile named like category_N_type.");
      for (const s of sheets) downloadBlob(s.name, s.blob);
      if (sheets.length) toast.success(`Made ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draw the sheet.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const setText = (k: keyof AssignmentTexts, v: string) => setUi((p) => ({ ...p, texts: { ...defaultAssignmentTexts(), ...p.texts, [k]: v } }));
  const area = (k: keyof AssignmentTexts, label: string, rows: number) => (
    <label className="block space-y-0.5 text-[10px] text-muted-foreground">
      {label}
      <textarea value={texts[k]} onChange={(e) => setText(k, e.target.value)} rows={rows} className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 text-[11px] text-foreground outline-none focus-visible:border-ring" />
    </label>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Assignment 2 sheets</div>
      <p className="text-[10px] text-muted-foreground">The pages the assignment asks for, drawn from the Analysis evaluation and the Arrange interlock test. PNG, in the size you set; place them in your presentation at any size.</p>
      {!ev.ready && <p className="text-[10px] text-orange">Still reading the tiles…</p>}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Page</span>
        <input type="number" min={6} max={60} step={0.5} value={ui.widthIn} onChange={(e) => setUi((p) => ({ ...p, widthIn: Math.max(6, Math.min(60, Number(e.target.value) || p.widthIn)) }))} className="h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground" aria-label="Sheet width in inches" />
        <span>×</span>
        <input type="number" min={4} max={60} step={0.5} value={ui.heightIn} onChange={(e) => setUi((p) => ({ ...p, heightIn: Math.max(4, Math.min(60, Number(e.target.value) || p.heightIn)) }))} className="h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground" aria-label="Sheet height in inches" />
        <span>in at</span>
        <Select className="h-7 w-24 text-[11px]" value={String(ui.dpi)} onChange={(e) => setUi((p) => ({ ...p, dpi: Number(e.target.value) }))} aria-label="Sheet resolution">
          {[72, 100, 150, 200, 300].map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setUi((p) => ({ ...p, widthIn: 22, heightIn: 11 }))} title="11 × 22 inches, landscape">
          22 × 11
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setUi((p) => ({ ...p, widthIn: 53.33, heightIn: 30, dpi: 72 }))} title="A 16:9 page for a TV (53 × 30 in at 72 dpi is 3840 × 2160 px)">
          TV 4K
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{Math.round(ui.widthIn * ui.dpi)} × {Math.round(ui.heightIn * ui.dpi)} px</p>
      <div className="space-y-1">
        {SHEETS.map((s) => (
          <Button key={s.kind} className="w-full justify-start" variant="outline" size="sm" title={s.hint} disabled={!!busy || !ev.ready || !ev.tiles.length} onClick={() => void run(s.kind)}>
            {busy === s.kind ? `Drawing… ${progress}` : s.label}
          </Button>
        ))}
      </div>
      <details className="rounded-md border-hair px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Text for the workflow, logs, insights and references</summary>
        <div className="mt-2 space-y-2">
          {area("workflow", "Workflow", 6)}
          {area("versur", "Versur run logs (paste them here)", 5)}
          {area("insights", "Overall insights (empty: a draft from the numbers)", 5)}
          {area("references", "References", 4)}
        </div>
      </details>
    </div>
  );
}
