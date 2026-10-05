"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { downloadTextFile } from "@/lib/exporters/objExport";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { drawingFromState, type DrawState } from "@/lib/drawing/state";
import type { DrawingHighlight } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, drawingStyle, drawingToPng, drawingToSvg } from "@/lib/drawing/render";
import type { ParsedTile } from "@/lib/types";

/** The automatic plan / section of a tile, drawn to fit its viewport (the app's dark palette, or paper). */
export function DrawingView({ tile, draw, highlight }: { tile: ParsedTile; draw: DrawState; highlight?: DrawingHighlight }) {
  const drawing = useMemo(() => drawingFromState(tile, draw, highlight), [tile, draw, highlight]);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawing || size.w < 10 || size.h < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const unit = drawingSize(drawing, { pxPerFt: 1 });
    const pxPerFt = Math.max(0.5, Math.min((size.w * dpr) / unit.width, (size.h * dpr) / unit.height));
    const style = drawingStyle(draw.ground);
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fitted = drawingSize(drawing, { pxPerFt });
    drawToCanvas(ctx, drawing, style, { pxPerFt, background: false }, { x: Math.floor((canvas.width - fitted.width) / 2), y: Math.floor((canvas.height - fitted.height) / 2) });
  }, [drawing, draw.ground, size]);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden rounded-lg" style={{ backgroundColor: drawingStyle(draw.ground).bg }}>
      {drawing ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">This tile has no voxel data to draw.</div>}
    </div>
  );
}

const SCALES = [
  { label: "1 in = 5 ft", feetPerInch: 5 },
  { label: "1 in = 10 ft", feetPerInch: 10 },
  { label: "1 in = 20 ft", feetPerInch: 20 },
];

/** SVG and PNG downloads of the drawing a viewport is showing, at a chosen scale. */
export function DrawingExport({ tile, draw, highlight }: { tile: ParsedTile; draw: DrawState; highlight?: DrawingHighlight }) {
  const [feetPerInch, setFeetPerInch] = useState(10);
  const [dpi, setDpi] = useState(200);
  const [paper, setPaper] = useState(false);
  const [busy, setBusy] = useState(false);
  const stem = () => {
    const d = drawingFromState(tile, draw, highlight);
    if (!d) return null;
    const tag = d.spec.kind === "plan" ? `plan_${(d.subtitle.split(":")[1] ?? "").trim().replace(/[^a-z0-9]+/gi, "_").toLowerCase()}` : `section_${d.spec.axis}_${Math.round(d.spec.positionFt ?? 0)}ft`;
    return { d, name: `${tile.name}_${tag}` };
  };
  const style = () => drawingStyle(paper ? "paper" : "dark");

  const svg = () => {
    const s = stem();
    if (!s) return;
    downloadTextFile(`${s.name}.svg`, drawingToSvg(s.d, style(), { feetPerInch }), "image/svg+xml");
  };
  const png = async () => {
    const s = stem();
    if (!s) return;
    setBusy(true);
    try {
      downloadBlob(`${s.name}.png`, await drawingToPng(s.d, style(), { feetPerInch, dpi }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't write the PNG.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Scale</span>
        <Select className="h-6 w-32 text-[11px]" value={String(feetPerInch)} onChange={(e) => setFeetPerInch(Number(e.target.value))} aria-label="Drawing scale">
          {SCALES.map((s) => (
            <option key={s.feetPerInch} value={s.feetPerInch}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">PNG resolution</span>
        <Select className="h-6 w-32 text-[11px]" value={String(dpi)} onChange={(e) => setDpi(Number(e.target.value))} aria-label="PNG resolution">
          {[96, 150, 200, 300, 600].map((d) => (
            <option key={d} value={String(d)}>
              {d} dpi
            </option>
          ))}
        </Select>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
        White paper (for printing; off = black ground)
      </label>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={svg}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          SVG
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void png()}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          PNG
        </Button>
      </div>
    </div>
  );
}
