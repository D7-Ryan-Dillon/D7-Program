"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { Section } from "@/components/shared/Section";
import { Segmented } from "@/components/shared/Segmented";
import { downloadBlob, createBoardAnimation } from "@/lib/boards/exportBoard";
import { encodeGif } from "@/lib/boards/gifExport";
import { encodeMp4, mp4Supported } from "@/lib/boards/mp4Export";
import { FPS_OPTIONS, type AnimationSettings, type BoardConfig, type DitherMode } from "@/lib/boards/types";
import type { ParsedTile } from "@/lib/types";

type Kind = "gif" | "mp4";
interface Progress {
  label: string;
  done: number;
  total: number;
}
interface Result {
  url: string;
  kind: Kind;
  summary: string;
}

export const formatMb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 2 : 1)} MB`;

export function frameCountFor(a: AnimationSettings): number {
  return Math.max(2, Math.round(a.spinSeconds * a.fps));
}

export function AnimatedExportPanel({
  config,
  tileById,
  onChange,
  onBusyChange,
}: {
  config: BoardConfig;
  tileById: Map<string, ParsedTile>;
  onChange: (patch: Partial<AnimationSettings>) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const a = config.animation;
  const [busy, setBusy] = useState<Kind | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [mp4Ok] = useState(mp4Supported);
  const abortRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    },
    [],
  );

  const frames = frameCountFor(a);
  const heightPx = Math.round((a.widthPx * config.heightIn) / config.widthIn);
  const pages = ([1, 2] as const).filter((p) => (p === 1 ? a.page1 : a.page2));

  const run = async (kind: Kind) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(kind);
    onBusyChange?.(true);
    const base = config.name.trim().replace(/[^\w.-]+/g, "_") || "board";
    try {
      for (const page of pages) {
        const tag = pages.length > 1 ? `Page ${page}: ` : "";
        const source = await createBoardAnimation(config, tileById, page, frames, (done, total) => setProgress({ label: `${tag}loading tiles`, done, total }), ctrl.signal);
        try {
          let blob: Blob;
          let summary: string;
          if (kind === "gif") {
            const gif = await encodeGif(source, a, (phase, done, total) => setProgress({ label: `${tag}${phase === "palette" ? "choosing colours" : "encoding frames"}`, done, total }), ctrl.signal);
            blob = gif.blob;
            summary = `${gif.colors} colours${gif.dither === "none" ? "" : `, ${gif.dither === "ordered" ? "ordered" : "error-diffusion"} dither`}`;
          } else {
            blob = await encodeMp4(source, a.fps, (done, total) => setProgress({ label: `${tag}encoding video`, done, total }), ctrl.signal);
            summary = "H.264";
          }
          const name = `${base}-${page === 1 ? "board" : "descriptors"}.${kind}`;
          downloadBlob(name, blob);
          if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
          const url = URL.createObjectURL(blob);
          resultUrlRef.current = url;
          setResult({ url, kind, summary: `${name} -- ${formatMb(blob.size)}, ${source.width}x${source.height}, ${frames} frames, ${summary}` });
        } finally {
          source.dispose();
        }
      }
      toast.success(pages.length > 1 ? `Exported ${pages.length} ${kind.toUpperCase()}s` : `Exported the ${kind.toUpperCase()}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast.message("Export cancelled");
      else toast.error(err instanceof Error ? err.message : "Couldn't export the animation.");
    } finally {
      abortRef.current = null;
      setBusy(null);
      onBusyChange?.(false);
      setProgress(null);
    }
  };

  const ditherOptions: { value: DitherMode; label: string }[] = [
    { value: "none", label: "None" },
    { value: "ordered", label: "Ordered" },
    { value: "diffusion", label: "Diffusion" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Every tile turns one full 360&deg; about its vertical axis, from the view it&rsquo;s set to, all in sync. One turn is rendered and loops forever.
      </p>

      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Pages</div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="accent-[var(--magenta)]" checked={a.page1} disabled={!!busy} onChange={(e) => onChange({ page1: e.target.checked })} />
          Page 1 &mdash; the board
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="accent-[var(--magenta)]" checked={a.page2} disabled={!!busy} onChange={(e) => onChange({ page2: e.target.checked })} />
          Page 2 &mdash; descriptors
        </label>
      </div>

      <NumberSlider label="Spin time" value={a.spinSeconds} min={2} max={30} step={0.5} decimals={1} suffix="s" exact onChange={(spinSeconds) => onChange({ spinSeconds })} />
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Frame rate</div>
        <Segmented value={a.fps} options={FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` }))} onChange={(fps) => onChange({ fps })} />
      </div>
      <NumberSlider label="Output width" value={a.widthPx} min={300} max={5000} step={50} suffix="px" exact onChange={(widthPx) => onChange({ widthPx })} />
      <p className="font-mono text-[10px] text-muted-foreground">
        {a.widthPx}&times;{heightPx}px &middot; {frames} frames
      </p>
      {a.widthPx > 1600 && <p className="text-[10px] text-orange">Wide GIFs get very large (tens of MB). MP4 is usually much smaller at the same size.</p>}

      <Section id="boards.gifcolour" variant="inline" title="GIF colour" defaultOpen={false} summary={a.colors === "auto" ? "auto" : `${a.paletteSize} colours`}>
        <Segmented
          value={a.colors}
          options={[
            { value: "auto", label: "Auto" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(colors) => onChange({ colors })}
        />
        {a.colors === "auto" ? (
          <p className="text-[10px] text-muted-foreground">One palette built from the actual frames, as small as it can be without a visible difference; dithering only if smooth gradients need it.</p>
        ) : (
          <>
            <NumberSlider label="Palette size" value={a.paletteSize} min={16} max={256} step={1} suffix="colours" exact onChange={(paletteSize) => onChange({ paletteSize })} />
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Dither</div>
              <Segmented value={a.dither} options={ditherOptions} onChange={(dither) => onChange({ dither })} />
              <p className="text-[10px] text-muted-foreground">Ordered keeps the loop smooth and small; Diffusion is nicer on gradients but adds shimmer and size.</p>
            </div>
          </>
        )}
      </Section>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" disabled={!config.slots.length || !pages.length || !!busy} onClick={() => void run("gif")}>
          {busy === "gif" ? "Exporting…" : "Export GIF"}
        </Button>
        {mp4Ok && (
          <Button size="sm" variant="outline" disabled={!config.slots.length || !pages.length || !!busy} onClick={() => void run("mp4")}>
            {busy === "mp4" ? "Exporting…" : "Export MP4"}
          </Button>
        )}
        {busy && (
          <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gradient-to-r from-magenta to-orange transition-[width]" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {progress.label} {progress.done}/{progress.total} &mdash; keep this tab open
          </p>
        </div>
      )}
      {!mp4Ok && <p className="text-[10px] text-muted-foreground">MP4 export needs a recent Chrome, Edge or Safari.</p>}

      {result && (
        <div className="space-y-1">
          <div className="overflow-hidden rounded-md border-hair bg-black">
            {result.kind === "gif" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not something next/image can optimise
              <img src={result.url} alt="Last exported animation" className="w-full" />
            ) : (
              <video src={result.url} className="w-full" loop muted autoPlay playsInline controls />
            )}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">{result.summary}</p>
        </div>
      )}
    </div>
  );
}
