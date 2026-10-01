"use client";

import { useEffect, useRef, useState } from "react";
import { renderTileToDataUrl } from "@/lib/boards/renderTile";
import { frameClipPathPercent } from "@/lib/boards/cutCorner";
import { scoreTile } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";
import type { BoardConfig, BoardSlot } from "@/lib/boards/types";

const MAIN_HEIGHT_PCT = 87;
const IMAGE_WIDTH_PCT = 34;

export function DescriptorSlotCard({ slot, tile, config }: { slot: BoardSlot; tile: ParsedTile; config: BoardConfig }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const [imageAreaSize, setImageAreaSize] = useState({ width: 240, height: 300 });

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

  const results = scoreTile(tile);
  const topKeys = new Set(
    [...results]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.key),
  );

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{ border: `${config.outlineWidthPt}pt solid ${config.descriptorColor}`, clipPath: frameClipPathPercent() }}
    >
      <div className="relative flex" style={{ height: `${MAIN_HEIGHT_PCT}%` }}>
        <div className="flex-1 space-y-1 overflow-hidden px-2 pb-1.5 pt-[10%]" style={{ width: `${100 - IMAGE_WIDTH_PCT}%` }}>
          {results.map((r) => {
            const highlighted = topKeys.has(r.key);
            const color = highlighted ? config.highlightColor : config.descriptorColor;
            return (
              <div key={r.key} style={{ color }}>
                <div className="truncate font-mono text-[9px] uppercase tracking-label" style={{ fontWeight: highlighted ? 700 : 400 }}>
                  {r.label}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ backgroundColor: `${color}33` }}>
                    <div className="h-full rounded-full" style={{ width: `${r.score}%`, backgroundColor: color }} />
                  </div>
                  <span className="font-mono text-[8px] tabular-nums" style={{ color }}>
                    {r.score}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={imageAreaRef} className="relative overflow-hidden" style={{ width: `${IMAGE_WIDTH_PCT}%`, borderLeft: `${config.outlineWidthPt}pt solid ${config.descriptorColor}` }}>
          {imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element -- a locally rendered dataURL, not an optimizable remote asset
            <img src={imgSrc} alt={tile.name} className="h-full w-full" style={{ backgroundColor: config.backgroundColor }} />
          )}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-end px-2" style={{ backgroundColor: config.backgroundColor }}>
        <span className="truncate font-mono text-[11px] uppercase tracking-label" style={{ color: config.highlightColor }}>
          {tile.name}
        </span>
      </div>
    </div>
  );
}
