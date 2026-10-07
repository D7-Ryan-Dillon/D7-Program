"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/shared/Segmented";
import { useProjectUi } from "@/lib/project-store";
import { defaultPalette } from "@/lib/boardPalette";
import { MATRIX } from "@/lib/scoring/matrix";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { AXO_VIEWS } from "@/lib/faceViews";
import { INFO_ITEMS, defaultTilePage, drawTilePage, exportTilePage, type TilePageInput, type TilePageSettings } from "@/lib/boards/tilePage";
import type { BoardConfig } from "@/lib/boards/types";
import { useEvaluation } from "@/lib/useEvaluation";
import { FontField } from "./FontField";

const numField = "h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground";

/**
 * The tile page: one tile large on one side, your own text box on the other, and what the program knows about the tile (ticked) under the text box. Set the size,
 * the side, the view; export a PNG. Saved with the project.
 */
export function TilePageDialog({ open, onOpenChange, config, dpiFromBoard }: { open: boolean; onOpenChange: (o: boolean) => void; config: BoardConfig; dpiFromBoard: number }) {
  const ev = useEvaluation();
  const [st, setSt] = useProjectUi<TilePageSettings>("tilePage", defaultTilePage);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const seq = useRef(0);

  const tile = ev.tiles.find((t) => t.id === st.tileId) ?? ev.tiles[0];
  const patch = (p: Partial<TilePageSettings>) => setSt((prev) => ({ ...prev, ...p }));
  const setInfo = (key: string, on: boolean) => setSt((prev) => ({ ...prev, info: { ...prev.info, [key]: on } }));

  const input = (dpi: number): TilePageInput | null =>
    tile
      ? {
          settings: st,
          tile,
          evals: ev.evals,
          profile: ev.profile,
          palette: { ...defaultPalette(), bg: config.backgroundColor, accent: config.titleColor, heading: config.highlightColor, muted: config.descriptorColor },
          fontFamily: config.fontFamily,
          look: { foamColor: config.foamColor, voidColor: config.voidColor, foamOpacity: config.foamOpacity, voidOpacity: config.voidOpacity },
          dpi,
        }
      : null;

  // the live preview, drawn a moment after the last change
  const sig = useMemo(() => JSON.stringify([st, tile?.id, config.backgroundColor, config.titleColor, config.highlightColor, config.descriptorColor, config.fontFamily, ev.ready]), [st, tile?.id, config, ev.ready]);
  useEffect(() => {
    if (!open || !tile) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const inp = input(Math.max(30, Math.min(110, 1100 / st.widthIn)));
      if (!inp || !previewRef.current) return;
      setDrawing(true);
      try {
        const c = await drawTilePage(inp);
        if (mine !== seq.current || !previewRef.current) return;
        const out = previewRef.current;
        out.width = c.width;
        out.height = c.height;
        out.getContext("2d")?.drawImage(c, 0, 0);
      } catch (err) {
        console.error("[tile page] preview failed:", err);
      } finally {
        if (mine === seq.current) setDrawing(false);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig]);

  const exportPng = async () => {
    const inp = input(st.dpi || dpiFromBoard);
    if (!inp) return;
    setBusy(true);
    try {
      downloadBlob(`${(st.title || tile!.name).replace(/[^\w-]+/g, "_")}_page.png`, await exportTilePage(inp));
      toast.success("Made the tile page");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draw the page.");
    } finally {
      setBusy(false);
    }
  };

  const descriptorOn = (k: string) => !!st.info[`d.${k}`];
  const setAllDescriptors = (keys: string[]) => setSt((prev) => ({ ...prev, info: { ...prev.info, ...Object.fromEntries(MATRIX.map((m) => [`d.${m.key}`, keys.includes(m.key)])) } }));
  const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => (
    <label key={label} className="flex items-center gap-2 text-[11px] text-muted-foreground" title={hint}>
      <input type="checkbox" className="accent-[var(--magenta)]" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Tile page</DialogTitle>
        </DialogHeader>
        {!tile ? (
          <p className="text-sm text-muted-foreground">Load tiles in the Viewer tab first.</p>
        ) : (
          <div className="grid max-h-[78vh] gap-4 overflow-hidden lg:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
              <label className="block space-y-0.5 text-[10px] text-muted-foreground">
                Tile
                <Select className="h-8 w-full text-[11px]" value={tile.id} onChange={(e) => patch({ tileId: e.target.value })} aria-label="Tile">
                  {ev.tiles.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Layout</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  Tile on the
                  <Segmented value={st.side} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} onChange={(side) => patch({ side })} />
                </div>
                <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  View
                  <Select className="h-7 w-44 text-[11px]" value={st.view} onChange={(e) => patch({ view: e.target.value as TilePageSettings["view"] })} aria-label="View of the tile">
                    {AXO_VIEWS.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label}
                      </option>
                    ))}
                    <option value="plan">Plan drawing</option>
                    <option value="section">Section drawing</option>
                  </Select>
                </label>
                <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  Tile width: {Math.round(st.tileShare * 100)}% of the page
                  <input type="range" min={30} max={70} step={1} value={Math.round(st.tileShare * 100)} onChange={(e) => patch({ tileShare: Number(e.target.value) / 100 })} className="w-32 accent-[var(--magenta)]" />
                </label>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  Page
                  <input type="number" min={6} max={60} step={0.5} value={st.widthIn} onChange={(e) => patch({ widthIn: Math.max(6, Math.min(60, Number(e.target.value) || st.widthIn)) })} className={numField} aria-label="Page width in inches" />
                  ×
                  <input type="number" min={4} max={60} step={0.5} value={st.heightIn} onChange={(e) => patch({ heightIn: Math.max(4, Math.min(60, Number(e.target.value) || st.heightIn)) })} className={numField} aria-label="Page height in inches" />
                  in at
                  <Select className="h-7 w-24 text-[11px]" value={String(st.dpi)} onChange={(e) => patch({ dpi: Number(e.target.value) })} aria-label="Resolution">
                    {[72, 100, 150, 200, 300].map((d) => (
                      <option key={d} value={d}>
                        {d} dpi
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patch({ widthIn: 22, heightIn: 11 })}>
                    22 × 11
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patch({ widthIn: 17, heightIn: 11 })}>
                    17 × 11
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patch({ widthIn: 11, heightIn: 8.5 })}>
                    11 × 8.5
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patch({ widthIn: 53.33, heightIn: 30, dpi: 72 })} title="16:9 for a TV: 3840 × 2160 px at 72 dpi">
                    TV 4K
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{Math.round(st.widthIn * st.dpi)} × {Math.round(st.heightIn * st.dpi)} px</p>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Title and text</div>
                {check("Show a title", st.showTitle, (v) => patch({ showTitle: v }))}
                <input value={st.title} onChange={(e) => patch({ title: e.target.value })} placeholder={tile.name} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px] text-foreground outline-none focus-visible:border-ring" aria-label="Title" />
                <textarea
                  value={st.text}
                  onChange={(e) => patch({ text: e.target.value })}
                  rows={7}
                  placeholder="Your text. Press Enter for a new line (a blank line leaves a gap)."
                  className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-[11px] leading-relaxed text-foreground outline-none focus-visible:border-ring"
                  aria-label="Text box"
                />
                <div className="space-y-0.5 text-[10px] text-muted-foreground">
                  Font
                  <FontField value={st.font ?? ""} defaultFont={config.fontFamily} onChange={(font) => patch({ font })} />
                </div>
                <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  Text box may take {Math.round(st.textShare * 100)}% of the height
                  <input type="range" min={20} max={90} step={5} value={Math.round(st.textShare * 100)} onChange={(e) => patch({ textShare: Number(e.target.value) / 100 })} className="w-28 accent-[var(--magenta)]" />
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Under the text: what to show</div>
                {INFO_ITEMS.map((it) => check(it.label, !!st.info[it.key], (v) => setInfo(it.key, v), it.hint))}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[10px] text-muted-foreground">Descriptors</div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setAllDescriptors(MATRIX.map((m) => m.key))}>
                      All
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setAllDescriptors(ev.keys)} title="The descriptors this project carries forward">
                      Carried
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setAllDescriptors([])}>
                      None
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1 pl-1">{MATRIX.map((m) => check(m.name, descriptorOn(m.key), (v) => setInfo(`d.${m.key}`, v)))}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  {check("a bar", st.show.bar, (v) => patch({ show: { ...st.show, bar: v } }), "the bar and its word")}
                  {check("the measured result", st.show.result, (v) => patch({ show: { ...st.show, result: v } }), "the value with its unit and status")}
                  {check("the reading", st.show.reading, (v) => patch({ show: { ...st.show, reading: v } }), "the generated reading (yours where you wrote one)")}
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                  Columns
                  <Segmented value={String(st.columns)} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]} onChange={(v) => patch({ columns: Number(v) as 1 | 2 })} />
                  <label className="flex items-center gap-1.5">
                    Info text size
                    <input type="range" min={60} max={160} step={5} value={Math.round(st.infoScale * 100)} onChange={(e) => patch({ infoScale: Number(e.target.value) / 100 })} className="w-24 accent-[var(--magenta)]" />
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground">The info shrinks to fit the space under the text box. Colours, font and background follow the board settings.</p>
              </div>

              <Button className="w-full" disabled={busy || !ev.ready} onClick={() => void exportPng()}>
                {busy ? "Drawing…" : "Export the page (PNG)"}
              </Button>
            </div>

            <div className="relative flex min-h-[18rem] items-center justify-center overflow-auto rounded-lg border-hair bg-black/40 p-2">
              <canvas ref={previewRef} className="max-h-full max-w-full rounded-sm border border-white/15" style={{ aspectRatio: `${st.widthIn} / ${st.heightIn}` }} />
              {drawing && <div className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">drawing…</div>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
