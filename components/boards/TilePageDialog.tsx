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
import { INFO_ITEMS, createTilePageAnimation, defaultTilePage, drawTilePage, exportTilePage, type TilePageInput, type TilePageSettings } from "@/lib/boards/tilePage";
import { encodeGif } from "@/lib/boards/gifExport";
import { encodeMp4, mp4Supported } from "@/lib/boards/mp4Export";
import { formatMb } from "./AnimatedExportPanel";
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
  const [spin, setSpin] = useState<{ kind: "gif" | "mp4"; label: string; done: number; total: number } | null>(null);
  const [mp4Ok] = useState(mp4Supported);
  const abortRef = useRef<AbortController | null>(null);
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
          boardConfig: config,
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

  const spinExport = async (kind: "gif" | "mp4") => {
    const inp = input(st.dpi || dpiFromBoard);
    if (!inp || !tile) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const frames = Math.max(2, Math.round(st.anim.seconds * st.anim.fps));
    setSpin({ kind, label: "loading the tile", done: 0, total: 1 });
    try {
      const source = await createTilePageAnimation(inp, st.anim.widthPx, frames, undefined, ctrl.signal);
      try {
        const settings = { ...config.animation, fps: st.anim.fps, spinSeconds: st.anim.seconds, widthPx: st.anim.widthPx };
        let blob: Blob;
        if (kind === "gif") blob = (await encodeGif(source, settings, (phase, done, total) => setSpin({ kind, label: phase === "palette" ? "choosing colours" : "encoding frames", done, total }), ctrl.signal)).blob;
        else blob = await encodeMp4(source, st.anim.fps, (done, total) => setSpin({ kind, label: "encoding video", done, total }), ctrl.signal);
        downloadBlob(`${(st.title || tile.name).replace(/[^\w-]+/g, "_")}_spin.${kind}`, blob);
        toast.success(`Made the ${kind.toUpperCase()} (${formatMb(blob.size)}, ${source.width} × ${source.height}, ${frames} frames)`);
      } finally {
        source.dispose();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast.message("Export cancelled");
      else toast.error(err instanceof Error ? err.message : "Couldn't make the animation.");
    } finally {
      abortRef.current = null;
      setSpin(null);
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
                <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Lines of text</div>
                <input value={st.caption} onChange={(e) => patch({ caption: e.target.value })} placeholder="A line under the tile (optional)" className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px] text-foreground outline-none focus-visible:border-ring" aria-label="Line under the tile" />
                {check("The footer from the Boards tab", st.boardsFooter, (v) => patch({ boardsFooter: v }), "the rule, logo and text set under Board settings → Footer")}
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
                  {check("fit to its type", st.show.fit, (v) => patch({ show: { ...st.show, fit: v } }), "how close the measurement is to what the tile's type prefers")}
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

              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Spinning export (GIF / MP4)</div>
                <p className="text-[10px] text-muted-foreground">The tile turns one full 360° about its vertical axis from the view chosen above, and the page stays still. It loops. Needs a 3D view.</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    Spin
                    <input type="number" min={2} max={30} step={0.5} value={st.anim.seconds} onChange={(e) => patch({ anim: { ...st.anim, seconds: Math.max(2, Math.min(30, Number(e.target.value) || st.anim.seconds)) } })} className={numField} aria-label="Seconds per turn" />
                    s
                  </label>
                  <Segmented value={String(st.anim.fps)} options={[{ value: "10", label: "10 fps" }, { value: "20", label: "20 fps" }, { value: "30", label: "30 fps" }]} onChange={(v) => patch({ anim: { ...st.anim, fps: Number(v) } })} />
                  <label className="flex items-center gap-1.5">
                    Width
                    <input type="number" min={300} max={4000} step={100} value={st.anim.widthPx} onChange={(e) => patch({ anim: { ...st.anim, widthPx: Math.max(300, Math.min(4000, Number(e.target.value) || st.anim.widthPx)) } })} className={numField} aria-label="Animation width in pixels" />
                    px
                  </label>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground">{st.anim.widthPx} × {Math.round((st.anim.widthPx * st.heightIn) / st.widthIn)} px · {Math.max(2, Math.round(st.anim.seconds * st.anim.fps))} frames</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!spin || !ev.ready || st.view === "plan" || st.view === "section"} onClick={() => void spinExport("gif")}>
                    {spin?.kind === "gif" ? "Exporting…" : "Export GIF"}
                  </Button>
                  {mp4Ok && (
                    <Button size="sm" variant="outline" disabled={!!spin || !ev.ready || st.view === "plan" || st.view === "section"} onClick={() => void spinExport("mp4")}>
                      {spin?.kind === "mp4" ? "Exporting…" : "Export MP4"}
                    </Button>
                  )}
                  {spin && (
                    <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                      Cancel
                    </Button>
                  )}
                </div>
                {spin && (
                  <div className="space-y-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-gradient-to-r from-magenta to-orange transition-[width]" style={{ width: `${(spin.done / Math.max(spin.total, 1)) * 100}%` }} />
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground">{spin.label} {spin.done}/{spin.total} — keep this tab open</p>
                  </div>
                )}
                {st.view === "plan" || st.view === "section" ? <p className="text-[10px] text-orange">Choose a 3D view above to export a spin.</p> : null}
                {!mp4Ok && <p className="text-[10px] text-muted-foreground">MP4 export needs a recent Chrome, Edge or Safari.</p>}
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
