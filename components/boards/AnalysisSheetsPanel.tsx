"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useProjectUi } from "@/lib/project-store";
import { defaultPalette } from "@/lib/boardPalette";
import { buildAnalysisSheets, defaultSheetContent, type SheetContent } from "@/lib/boards/analysisSheets";
import { downloadBlob } from "@/lib/boards/exportBoard";
import type { BoardConfig } from "@/lib/boards/types";
import { useEvaluation } from "@/lib/useEvaluation";

interface SheetsUi {
  content: SheetContent;
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** the typology to make sheets for ("" = the one the first tile on the board belongs to) */
  typology: string;
}
const defaultSheetsUi = (): SheetsUi => ({ content: defaultSheetContent(), widthIn: 22, heightIn: 11, dpi: 150, typology: "" });

const CONTENT: { key: keyof SheetContent; label: string; hint: string }[] = [
  { key: "intention", label: "Typology and spatial intention", hint: "the typology, its variants, and what it is about" },
  { key: "criteria", label: "Original descriptors and criteria", hint: "the matrix's own words: descriptor, qualitative and quantitative criteria, precedent" },
  { key: "reasons", label: "Carried forward / set aside, with reasons", hint: "which criteria this phase carries and why" },
  { key: "measures", label: "Measurements and units", hint: "each value with its unit and its status (measured, proxy, assumed, not assessable...)" },
  { key: "readings", label: "Readings and your edits", hint: "the automated readings, and any you wrote (marked ✎)" },
  { key: "diagrams", label: "Evidence diagrams and usable space", hint: "plans and sections with the evidence marked, and the usable-space check" },
  { key: "selection", label: "Suggested selection and rationale", hint: "which variant the evidence supports, and why (or that it does not)" },
];

/**
 * Presentation sheets for a typology, landscape on the board's black background (22 × 11 in by default, any size). They are drawn from the same
 * evaluation as the Analysis tab and the exports, so the three agree. Each kind of content can be left out, and a sheet with none of its content is not made.
 */
export function AnalysisSheetsPanel({ config, dpiFromBoard }: { config: BoardConfig; dpiFromBoard: number }) {
  const ev = useEvaluation();
  const [ui, setUi] = useProjectUi<SheetsUi>("analysisSheets", defaultSheetsUi);
  const [busy, setBusy] = useState(false);
  const firstTile = config.slots.map((s) => ev.tiles.find((t) => t.id === s.tileId)).find(Boolean);
  const group = useMemo(() => ev.groups.find((g) => g.key === ui.typology) ?? ev.groups.find((g) => g.tiles.some((t) => t.id === firstTile?.id)) ?? ev.groups[0], [ev.groups, ui.typology, firstTile]);
  const setContent = (k: keyof SheetContent, v: boolean) => setUi((p) => ({ ...p, content: { ...p.content, [k]: v } }));

  const run = async () => {
    if (!group) return;
    setBusy(true);
    try {
      const palette = { ...defaultPalette(), bg: config.backgroundColor, accent: config.titleColor, heading: config.highlightColor, muted: config.descriptorColor };
      const sheets = await buildAnalysisSheets({
        project: config.name,
        group,
        evals: ev.evals,
        profile: ev.profile,
        carried: ev.keys,
        reasons: ev.reasons,
        setAside: ev.setAside,
        pick: ev.picks.get(group.key) ?? null,
        palette,
        fontFamily: config.fontFamily,
        content: ui.content,
        widthIn: ui.widthIn,
        heightIn: ui.heightIn,
        dpi: ui.dpi || dpiFromBoard,
      });
      if (!sheets.length) toast.error("Every kind of content is switched off: nothing to draw.");
      for (const s of sheets) downloadBlob(s.name, s.blob);
      if (sheets.length) toast.success(`Made ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draw the sheets.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Analysis sheets</div>
      <p className="text-[10px] text-muted-foreground">From the same evaluation as the Analysis tab: landscape pages on the board&apos;s background, filled in automatically. Leave out what you do not want.</p>
      {!ev.ready && <p className="text-[10px] text-orange">Still reading the tiles…</p>}
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        Typology
        <Select className="h-7 w-56 text-[11px]" value={group?.key ?? ""} onChange={(e) => setUi((p) => ({ ...p, typology: e.target.value }))} aria-label="Typology for the sheets">
          {ev.groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label} ({g.tiles.length})
            </option>
          ))}
        </Select>
      </label>
      <div className="space-y-1">
        {CONTENT.map((c) => (
          <label key={c.key} className="flex items-start gap-2 text-[11px]" title={c.hint}>
            <input type="checkbox" className="mt-0.5 accent-[var(--magenta)]" checked={ui.content[c.key]} onChange={(e) => setContent(c.key, e.target.checked)} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Page</span>
        <input type="number" min={6} max={48} step={0.5} value={ui.widthIn} onChange={(e) => setUi((p) => ({ ...p, widthIn: Math.max(6, Math.min(48, Number(e.target.value) || p.widthIn)) }))} className="h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground" aria-label="Sheet width in inches" />
        <span>×</span>
        <input type="number" min={4} max={48} step={0.5} value={ui.heightIn} onChange={(e) => setUi((p) => ({ ...p, heightIn: Math.max(4, Math.min(48, Number(e.target.value) || p.heightIn)) }))} className="h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground" aria-label="Sheet height in inches" />
        <span>in at</span>
        <Select className="h-7 w-24 text-[11px]" value={String(ui.dpi)} onChange={(e) => setUi((p) => ({ ...p, dpi: Number(e.target.value) }))} aria-label="Sheet resolution">
          {[100, 150, 200, 300].map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setUi((p) => ({ ...p, widthIn: 22, heightIn: 11 }))} title="11 × 22 inches, landscape">
          22 × 11
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{Math.round(ui.widthIn * ui.dpi)} × {Math.round(ui.heightIn * ui.dpi)} px</p>
      <Button className="w-full justify-start" variant="outline" size="sm" disabled={busy || !group || !ev.ready} onClick={() => void run()}>
        {busy ? "Drawing…" : "Analysis sheets as PNG"}
      </Button>
    </div>
  );
}
