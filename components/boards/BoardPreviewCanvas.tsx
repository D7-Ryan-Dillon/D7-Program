"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AXO_VIEWS } from "@/lib/faceViews";
import { computeGeometry, renderBoardPreview } from "@/lib/boards/exportBoard";
import { DIVIDER_X, TAG_HEIGHT_FRACTION } from "@/lib/boards/frameShape";
import type { AxoViewKey, BoardConfig } from "@/lib/boards/types";
import type { ParsedTile } from "@/lib/types";
import { Input } from "@/components/ui/input";

/** Renders a board page by calling the exact same drawing code as the real
 * PNG export (just at a smaller effective DPI), so the preview can never
 * drift from what actually gets exported. A thin absolutely-positioned
 * overlay (computed from the same geometry function, not re-derived)
 * supplies the only pieces a canvas can't: per-tile remove/view controls,
 * and a click-to-reveal name-size override. */
export function BoardPreviewCanvas({
  config,
  tileById,
  page,
  onRemoveSlot,
  onChangeSlotView,
  onChangeSlotNameSize,
}: {
  config: BoardConfig;
  tileById: Map<string, ParsedTile>;
  page: 1 | 2;
  onRemoveSlot: (slotId: string) => void;
  onChangeSlotView: (slotId: string, view: AxoViewKey) => void;
  onChangeSlotNameSize: (slotId: string, sizePt: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 10) setContainerWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const timer = setTimeout(() => {
      void renderBoardPreview(canvas, config, tileById, page, containerWidth);
    }, 150);
    return () => clearTimeout(timer);
  }, [config, tileById, page, containerWidth]);

  const dpi = containerWidth / config.widthIn;
  const geo = computeGeometry(config, dpi);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {page === 1 &&
        config.slots.map((slot, i) => {
          const cellIndex = (geo.captionCellIndex !== null ? 1 : 0) + i;
          const cell = geo.cells[cellIndex];
          const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
          if (!cell || !tile) return null;
          const tagX = cell.x + cell.size * DIVIDER_X;
          const tagY = cell.y + cell.size;
          const tagW = cell.x + cell.size - tagX;
          const tagH = cell.size * TAG_HEIGHT_FRACTION;

          return (
            <div key={slot.id}>
              <div
                className="absolute"
                style={{ left: cell.x, top: cell.y, width: cell.size, height: cell.size }}
                onMouseEnter={() => setHoveredSlotId(slot.id)}
                onMouseLeave={() => setHoveredSlotId((id) => (id === slot.id ? null : id))}
              >
                {hoveredSlotId === slot.id && (
                  <>
                    <button onClick={() => onRemoveSlot(slot.id)} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1" aria-label={`Remove ${tile.name}`}>
                      <X className="h-3 w-3 text-white" />
                    </button>
                    <select
                      className="absolute left-1.5 top-1.5 h-6 rounded border border-input bg-black/70 px-1 text-[10px] text-white"
                      value={slot.view}
                      onChange={(e) => onChangeSlotView(slot.id, e.target.value as AxoViewKey)}
                    >
                      {AXO_VIEWS.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <button
                className="absolute cursor-text"
                style={{ left: tagX, top: tagY, width: Math.max(0, tagW), height: Math.max(0, tagH) }}
                onClick={() => setEditingSlotId(slot.id)}
                aria-label={`Edit ${tile.name} name text size`}
              />
              {editingSlotId === slot.id && (
                <div className="absolute z-10 flex items-center gap-1 rounded-md border border-input bg-black/90 p-1 shadow-lg" style={{ left: tagX, top: Math.max(0, tagY - 34) }}>
                  <Input
                    type="number"
                    min={4}
                    max={200}
                    value={slot.nameFontSizePt ?? ""}
                    placeholder="Auto"
                    className="h-6 w-16 text-[10px]"
                    onChange={(e) => onChangeSlotNameSize(slot.id, e.target.value ? Number(e.target.value) : null)}
                  />
                  <span className="pr-1 text-[9px] text-muted-foreground">pt</span>
                  <button className="pr-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setEditingSlotId(null)}>
                    done
                  </button>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
