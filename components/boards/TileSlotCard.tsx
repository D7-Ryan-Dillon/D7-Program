"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AXO_VIEWS } from "@/lib/faceViews";
import { renderTileToDataUrl } from "@/lib/boards/renderTile";
import { frameClipPathPercent } from "@/lib/boards/cutCorner";
import type { ParsedTile } from "@/lib/types";
import type { AxoViewKey, BoardConfig, BoardSlot } from "@/lib/boards/types";

const MAIN_HEIGHT_PCT = 87; // keep in sync with frameMetricsFor's default tagHeightPercent

export function TileSlotCard({
  slot,
  tile,
  config,
  onChangeView,
  onRemove,
}: {
  slot: BoardSlot;
  tile: ParsedTile;
  config: BoardConfig;
  onChangeView: (view: AxoViewKey) => void;
  onRemove: () => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const [imageAreaSize, setImageAreaSize] = useState({ width: 480, height: 360 });

  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 4 && height > 4) setImageAreaSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void renderTileToDataUrl({
      glbUrl: tile.glbUrl,
      view: slot.view,
      width: imageAreaSize.width,
      height: imageAreaSize.height,
      backgroundColor: config.backgroundColor,
      foamColor: config.foamColor,
      voidColor: config.voidColor,
      foamOpacity: config.foamOpacity,
      voidOpacity: config.voidOpacity,
      foamVisible: true,
      voidVisible: true,
    }).then((url) => {
      if (!cancelled) setImgSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [tile.glbUrl, slot.view, config.backgroundColor, config.foamColor, config.voidColor, config.foamOpacity, config.voidOpacity, imageAreaSize.width, imageAreaSize.height]);

  return (
    <div className="group relative h-full w-full">
      <div
        className="relative flex h-full w-full flex-col"
        style={{ border: `${config.outlineWidthPt}pt solid ${config.descriptorColor}`, clipPath: frameClipPathPercent() }}
      >
        <div ref={imageAreaRef} className="relative overflow-hidden" style={{ height: `${MAIN_HEIGHT_PCT}%` }}>
          {imgSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- a locally rendered dataURL, not an optimizable remote asset
            <img src={imgSrc} alt={tile.name} className="h-full w-full" style={{ backgroundColor: config.backgroundColor }} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground" style={{ backgroundColor: config.backgroundColor }}>
              Rendering…
            </div>
          )}
        </div>
        <div className="flex flex-1 items-center justify-end px-2" style={{ backgroundColor: config.backgroundColor }}>
          <span className="truncate font-mono text-[11px] uppercase tracking-label" style={{ color: config.highlightColor }}>
            {tile.name}
          </span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Remove ${tile.name}`}
      >
        <X className="h-3 w-3 text-white" />
      </button>
      <select
        className="absolute bottom-1 left-1 h-6 rounded border border-input bg-black/60 px-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
        value={slot.view}
        onChange={(e) => onChangeView(e.target.value as AxoViewKey)}
      >
        {AXO_VIEWS.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label}
          </option>
        ))}
      </select>
    </div>
  );
}
