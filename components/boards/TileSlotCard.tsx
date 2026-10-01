"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AXO_VIEWS } from "@/lib/faceViews";
import { renderTileToDataUrl } from "@/lib/boards/renderTile";
import { cutCornerClipPathPercent } from "@/lib/boards/cutCorner";
import type { ParsedTile } from "@/lib/types";
import type { AxoViewKey, BoardConfig, BoardSlot } from "@/lib/boards/types";

const PREVIEW_SIZE = 480;

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

  useEffect(() => {
    let cancelled = false;
    void renderTileToDataUrl({
      glbUrl: tile.glbUrl,
      view: slot.view,
      size: PREVIEW_SIZE,
      backgroundColor: null,
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
  }, [tile.glbUrl, slot.view, config.foamColor, config.voidColor, config.foamOpacity, config.voidOpacity]);

  return (
    <div className="group relative flex h-full w-full flex-col">
      <div
        className="relative flex-1 overflow-hidden border"
        style={{ borderColor: config.descriptorColor, clipPath: cutCornerClipPathPercent() }}
      >
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- a locally rendered dataURL, not an optimizable remote asset
          <img src={imgSrc} alt={tile.name} className="h-full w-full object-cover" style={{ backgroundColor: config.backgroundColor }} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground" style={{ backgroundColor: config.backgroundColor }}>
            Rendering…
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`Remove ${tile.name}`}
        >
          <X className="h-3 w-3 text-white" />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate font-mono text-[10px] uppercase tracking-label" style={{ color: config.descriptorColor }}>
          {tile.name}
        </span>
        <select
          className="h-6 shrink-0 rounded border border-input bg-transparent px-1 text-[10px]"
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
    </div>
  );
}
