"use client";

import { Select } from "@/components/ui/select";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Download, ImageIcon, Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { ColorField } from "@/components/boards/ColorField";
import { Section } from "@/components/shared/Section";
import { Segmented } from "@/components/shared/Segmented";
import { formatMb } from "@/components/boards/AnimatedExportPanel";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { encodeGif } from "@/lib/boards/gifExport";
import { encodeMp4, mp4Supported } from "@/lib/boards/mp4Export";
import { AXO_VIEWS } from "@/lib/faceViews";
import { FPS_OPTIONS, defaultAnimationSettings, type AnimationSettings, type DitherMode } from "@/lib/boards/types";
import { useProject, useProjectUi } from "@/lib/project-store";
import { QUALITY_CHOICES, refineByTileId, type Quality } from "@/lib/fineGeometry";
import { captureViewportPng, createViewportAnimation, previewViewport, setPngDpi, type ViewportHandle } from "@/lib/viewportCapture";

type Aspect = "view" | "1:1" | "4:3" | "16:9" | "3:2" | "custom";
const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "view", label: "As viewed" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "custom", label: "Custom" },
];

function ratioOf(aspect: Aspect, live: number, custom = 1): number {
  if (aspect === "view") return live || 1;
  if (aspect === "custom") return custom;
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

/** Remembered per project: the last choice and every setting behind it. */
interface ExportUi {
  mode: "png" | "turntable";
  /** how finely the model is rebuilt for the export (the live view keeps the light mesh) */
  quality?: Quality;
  png: { sizeBy: "px" | "print"; heightPx?: number; widthPx: number; widthIn: number; dpi: number; aspect: Aspect; transparent: boolean; background: string };
  turntable: { format: "gif" | "mp4"; heightPx?: number; startView: string; spinSeconds: number; fps: number; widthPx: number; aspect: Aspect; background: string; colors: "auto" | "custom"; paletteSize: number; dither: DitherMode };
}
const defaultExportUi = (): ExportUi => ({
  mode: "png",
  png: { sizeBy: "px", widthPx: 2400, widthIn: 8, dpi: 300, aspect: "view", transparent: false, background: "#000000" },
  turntable: { format: "gif", startView: "iso-top-ne", spinSeconds: 8, fps: 20, widthPx: 800, aspect: "1:1", background: "#000000", colors: "auto", paletteSize: 128, dither: "none" },
});

const slug = (s: string) => s.trim().replace(/[^\w.-]+/g, "_") || "view";

/** The one Export button every viewport has: pick "current view (PNG)" or
 * "turntable (GIF / MP4)", then that choice's settings. The viewport is
 * re-rendered offscreen at the chosen size (lib/viewportCapture.ts), so the
 * live view is never touched. */
export function ViewportExportButton({ handleRef, name, className }: { handleRef: MutableRefObject<ViewportHandle | null>; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [liveAspect, setLiveAspect] = useState(1);
  const [step, setStep] = useState<"choose" | "png" | "turntable">("choose");
  const [ui, setUi] = useProjectUi<ExportUi>("viewportExport", defaultExportUi);
  const { tiles } = useProject();
  const quality: Quality = ui.quality ?? 3;
  /** Swaps the smooth, high-detail mesh into the live scene for the length of an export; returns the undo. */
  const refine = () => {
    const snap = handleRef.current?.snapshot();
    return snap && quality ? refineByTileId(snap.scene, new Map(tiles.map((x) => [x.id, x])), quality) : () => {};
  };
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const t = ui.turntable;
  const p = ui.png;
  const setPng = (patch: Partial<ExportUi["png"]>) => setUi((prev) => ({ ...prev, png: { ...prev.png, ...patch } }));
  const setTurn = (patch: Partial<ExportUi["turntable"]>) => setUi((prev) => ({ ...prev, turntable: { ...prev.turntable, ...patch } }));

  const openDialog = () => {
    setLiveAspect(handleRef.current?.snapshot()?.aspect ?? 1);
    setStep("choose");
    setNote(null);
    setOpen(true);
  };
  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
  };

  const pngWidth = p.sizeBy === "print" ? Math.round(p.widthIn * p.dpi) : p.widthPx;
  const pngHeight = p.aspect === "custom" ? Math.round(p.heightPx ?? 1350) : Math.round(pngWidth / ratioOf(p.aspect, liveAspect));
  const turnRatio = ratioOf(t.aspect, liveAspect, t.widthPx / (t.heightPx ?? 800));

  // First-frame preview: exactly what the turntable's frame 0 will look like.
  useEffect(() => {
    if (!open || step !== "turntable") return;
    const timer = setTimeout(() => {
      const canvas = previewRef.current;
      if (!canvas) return;
      const w = 360;
      try {
        previewViewport(handleRef.current ?? { snapshot: () => null }, { width: w, height: Math.round(w / turnRatio), startView: t.startView, background: t.background }, canvas);
      } catch {
        /* the viewport may be mid-update; the next change redraws */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [open, step, t.startView, t.background, turnRatio, handleRef]);

  const exportPng = async () => {
    setBusy(true);
    const restore = refine();
    try {
      await new Promise((r) => setTimeout(r, 30));
      let blob = await captureViewportPng(handleRef.current ?? { snapshot: () => null }, { width: pngWidth, height: pngHeight, startView: "current", background: p.background, transparent: p.transparent });
      if (p.sizeBy === "print" || p.dpi !== 300) blob = await setPngDpi(blob, p.dpi);
      downloadBlob(`${slug(name)}-view.png`, blob);
      setNote(`${slug(name)}-view.png -- ${formatMb(blob.size)}`);
      toast.success("Exported the view");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export the view.");
    } finally {
      restore();
      setBusy(false);
    }
  };

  const exportTurntable = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    const frames = Math.max(2, Math.round(t.spinSeconds * t.fps));
    let source: ReturnType<typeof createViewportAnimation> | null = null;
    const restore = refine();
    try {
      const width = t.widthPx;
      source = createViewportAnimation(handleRef.current ?? { snapshot: () => null }, { width, height: Math.round(width / turnRatio), startView: t.startView, background: t.background }, frames);
      let blob: Blob;
      let detail: string;
      if (t.format === "gif") {
        const settings: AnimationSettings = { ...defaultAnimationSettings(), spinSeconds: t.spinSeconds, fps: t.fps, widthPx: t.widthPx, colors: t.colors, paletteSize: t.paletteSize, dither: t.dither };
        const gif = await encodeGif(source, settings, (phase, done, total) => setProgress({ label: phase === "palette" ? "choosing colours" : "encoding frames", done, total }), ctrl.signal);
        blob = gif.blob;
        detail = `${gif.colors} colours${gif.dither === "none" ? "" : `, ${gif.dither} dither`}`;
      } else {
        blob = await encodeMp4(source, t.fps, (done, total) => setProgress({ label: "encoding video", done, total }), ctrl.signal);
        detail = "H.264";
      }
      const file = `${slug(name)}-turntable.${t.format}`;
      downloadBlob(file, blob);
      setNote(`${file} -- ${formatMb(blob.size)}, ${source.width}x${source.height}, ${frames} frames, ${detail}`);
      toast.success(`Exported the ${t.format.toUpperCase()}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast.message("Export cancelled");
      else toast.error(err instanceof Error ? err.message : "Couldn't export the turntable.");
    } finally {
      source?.dispose();
      restore();
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const ditherOptions: { value: DitherMode; label: string }[] = [
    { value: "none", label: "None" },
    { value: "ordered", label: "Ordered" },
    { value: "diffusion", label: "Diffusion" },
  ];

  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={className ?? "h-7 gap-1 px-2 text-[11px]"} onClick={openDialog} title="Export this view as an image or a turntable">
        <Download className="h-3 w-3" />
        Export
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export · {name}</DialogTitle>
            <DialogDescription>{step === "choose" ? "What would you like to export?" : step === "png" ? "Current view as a PNG" : "Turntable: one full turn, looping"}</DialogDescription>
          </DialogHeader>

          {step === "choose" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["png", "Current view", "A high-resolution PNG of exactly what you see.", ImageIcon],
                  ["turntable", "Turntable", "A looping GIF or MP4 of one full turn.", Film],
                ] as const
              ).map(([key, title, blurb, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setUi((prev) => ({ ...prev, mode: key }));
                    setStep(key);
                  }}
                  className={`rounded-lg border-hair p-3 text-left transition-colors hover:border-white/30 ${ui.mode === key ? "border-magenta/50 bg-magenta/10" : ""}`}
                >
                  <Icon className="mb-1.5 h-4 w-4 text-magenta" />
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground">{blurb}</div>
                  {ui.mode === key && <div className="mt-1 font-mono text-[9px] uppercase tracking-label text-muted-foreground">last used</div>}
                </button>
              ))}
            </div>
          )}

          {step === "png" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Mesh quality</div>
                <Select className="h-7 w-full text-[11px]" value={String(quality)} onChange={(e) => setUi((prev) => ({ ...prev, quality: Number(e.target.value) as Quality }))} aria-label="Mesh quality">
                  {QUALITY_CHOICES.map((q) => (
                    <option key={q.value} value={String(q.value)}>
                      {q.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Shape</div>
                <Segmented value={p.aspect} options={ASPECTS} onChange={(aspect) => setPng({ aspect })} />
              </div>
              {p.aspect === "custom" && <NumberSlider label="Height" value={p.heightPx ?? 1350} min={256} max={10000} step={64} suffix="px" exact onChange={(heightPx) => setPng({ heightPx })} />}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Size by</div>
                <Segmented
                  value={p.sizeBy}
                  options={[
                    { value: "px", label: "Pixels" },
                    { value: "print", label: "Print size + DPI" },
                  ]}
                  onChange={(sizeBy) => setPng({ sizeBy })}
                />
              </div>
              {p.sizeBy === "px" ? (
                <NumberSlider label="Width" value={p.widthPx} min={256} max={10000} step={64} suffix="px" exact onChange={(widthPx) => setPng({ widthPx })} />
              ) : (
                <>
                  <NumberSlider label="Print width" value={p.widthIn} min={1} max={60} step={0.25} decimals={2} suffix="in" exact onChange={(widthIn) => setPng({ widthIn })} />
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">DPI</span>
                    <Input type="number" min={72} max={1200} value={p.dpi} onChange={(e) => Number(e.target.value) > 0 && setPng({ dpi: Math.min(1200, Math.max(72, Number(e.target.value))) })} className="h-7 w-24 text-xs" />
                  </label>
                </>
              )}
              <p className="font-mono text-[10px] text-muted-foreground">
                {pngWidth}×{pngHeight}px{p.sizeBy === "print" ? ` · ${(pngWidth / p.dpi).toFixed(2)}×${(pngHeight / p.dpi).toFixed(2)} in at ${p.dpi} dpi` : ""}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Transparent background</span>
                <Switch checked={p.transparent} onCheckedChange={(transparent) => setPng({ transparent })} />
              </div>
              {!p.transparent && <ColorField label="Background" value={p.background} onChange={(background) => setPng({ background })} />}
            </div>
          )}

          {step === "turntable" && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto] items-start gap-3">
                <div className="space-y-2">
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">Starting corner</span>
                    <Select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={t.startView} onChange={(e) => setTurn({ startView: e.target.value })}>
                      <option value="current">Current camera</option>
                      {AXO_VIEWS.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <p className="text-[10px] text-muted-foreground">Use the same corner on every export so several on one page start in step.</p>
                </div>
                <div className="space-y-1">
                  <div className="font-mono text-[9px] uppercase tracking-label text-muted-foreground">First frame</div>
                  <canvas ref={previewRef} className="w-[150px] rounded-md border-hair bg-black" style={{ aspectRatio: String(turnRatio) }} />
                </div>
              </div>
              <Section id="export.output" variant="inline" title="Format & size" summary={`${t.format.toUpperCase()} · ${Math.round(t.widthPx)}px · ${t.fps} fps`}>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Format</div>
                <Segmented
                  value={t.format}
                  options={[
                    { value: "gif", label: "GIF (loops forever)" },
                    ...(mp4Supported() ? [{ value: "mp4" as const, label: "MP4" }] : []),
                  ]}
                  onChange={(format) => setTurn({ format })}
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Mesh quality</div>
                <Select className="h-7 w-full text-[11px]" value={String(quality)} onChange={(e) => setUi((prev) => ({ ...prev, quality: Number(e.target.value) as Quality }))} aria-label="Mesh quality">
                  {QUALITY_CHOICES.map((q) => (
                    <option key={q.value} value={String(q.value)}>
                      {q.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Shape</div>
                <Segmented value={t.aspect} options={ASPECTS} onChange={(aspect) => setTurn({ aspect })} />
              </div>
              {t.aspect === "custom" && <NumberSlider label="Height" value={t.heightPx ?? 800} min={200} max={4000} step={50} suffix="px" exact onChange={(heightPx) => setTurn({ heightPx })} />}
              <NumberSlider label="Spin time" value={t.spinSeconds} min={2} max={30} step={0.5} decimals={1} suffix="s" exact onChange={(spinSeconds) => setTurn({ spinSeconds })} />
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Frame rate</div>
                <Segmented value={t.fps} options={FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` }))} onChange={(fps) => setTurn({ fps })} />
              </div>
              <NumberSlider label="Width" value={t.widthPx} min={200} max={4000} step={50} suffix="px" exact onChange={(widthPx) => setTurn({ widthPx })} />
              <p className="font-mono text-[10px] text-muted-foreground">
                {Math.round(t.widthPx)}×{Math.round(t.widthPx / turnRatio)}px · {Math.max(2, Math.round(t.spinSeconds * t.fps))} frames
              </p>
              </Section>
              <Section id="export.colour" variant="inline" title="Colour" defaultOpen={false} summary={t.format === "gif" ? `GIF ${t.colors}` : "background"}>
              <ColorField label="Background" value={t.background} onChange={(background) => setTurn({ background })} />
              {t.format === "gif" && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">GIF colour</div>
                  <Segmented
                    value={t.colors}
                    options={[
                      { value: "auto", label: "Auto" },
                      { value: "custom", label: "Custom" },
                    ]}
                    onChange={(colors) => setTurn({ colors })}
                  />
                  {t.colors === "auto" ? (
                    <p className="text-[10px] text-muted-foreground">One palette built from the actual frames, as small as it can be without a visible difference.</p>
                  ) : (
                    <>
                      <NumberSlider label="Palette size" value={t.paletteSize} min={16} max={256} step={1} suffix="colours" exact onChange={(paletteSize) => setTurn({ paletteSize })} />
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Dither</div>
                        <Segmented value={t.dither} options={ditherOptions} onChange={(dither) => setTurn({ dither })} />
                      </div>
                    </>
                  )}
                </div>
              )}
              </Section>
            </div>
          )}

          {progress && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-gradient-to-r from-magenta to-orange transition-[width]" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                {progress.label} {progress.done}/{progress.total} — keep this tab open
              </p>
            </div>
          )}
          {note && <p className="font-mono text-[10px] text-muted-foreground">{note}</p>}

          {step !== "choose" && (
            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setStep("choose")}>
                Back
              </Button>
              <div className="flex gap-2">
                {busy && step === "turntable" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </Button>
                )}
                <Button type="button" size="sm" disabled={busy} onClick={() => void (step === "png" ? exportPng() : exportTurntable())}>
                  {busy ? "Exporting…" : step === "png" ? "Export PNG" : `Export ${t.format.toUpperCase()}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
