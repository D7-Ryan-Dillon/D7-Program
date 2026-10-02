"use client";

import { Select } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AXO_VIEWS } from "@/lib/faceViews";
import { computeGeometry, renderBoardPreview } from "@/lib/boards/exportBoard";
import { resolveTag } from "@/lib/boards/tileLabel";
import { CATALOGUE_CATEGORIES, type AxoViewKey, type BoardConfig, type BoardSlot } from "@/lib/boards/types";
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
  onChangeSlot,
  onEditSlot,
}: {
  config: BoardConfig;
  tileById: Map<string, ParsedTile>;
  page: 1 | 2;
  onRemoveSlot: (slotId: string) => void;
  onChangeSlotView: (slotId: string, view: AxoViewKey) => void;
  onChangeSlotNameSize: (slotId: string, sizePt: number | null) => void;
  onChangeSlot: (slotId: string, patch: Partial<BoardSlot>) => void;
  onEditSlot: (slotId: string) => void;
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
  const geo = computeGeometry(config, dpi, tileById);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {page === 1 &&
        config.slots.map((slot, i) => {
          const cell = geo.cells[geo.slotCellIndex[i]];
          const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
          if (!cell || !tile) return null;
          const tagX = cell.x + cell.size * geo.tag.startX;
          const tagY = cell.y + cell.size;
          const tagW = cell.x + cell.size - tagX;
          const tagH = cell.size * geo.tag.height;
          const resolved = resolveTag(tile.name, slot);

          return (
            <div key={slot.id}>
              <div
                className="absolute cursor-pointer"
                style={{ left: cell.x, top: cell.y, width: cell.size, height: cell.size }}
                onMouseEnter={() => setHoveredSlotId(slot.id)}
                onMouseLeave={() => setHoveredSlotId((id) => (id === slot.id ? null : id))}
                onClick={() => onEditSlot(slot.id)}
                title="Click to edit this tile's view, clipping, and material"
              >
                {slot.overrides && <div className="absolute left-1.5 bottom-1.5 rounded-full bg-magenta/80 px-1.5 py-0.5 text-[9px] uppercase tracking-label text-white">Custom</div>}
                {hoveredSlotId === slot.id && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSlot(slot.id);
                      }}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1"
                      aria-label={`Remove ${tile.name}`}
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                    <Select
                      className="absolute left-1.5 top-1.5 h-6 rounded border border-input bg-black/70 px-1 text-[10px] text-white"
                      value={slot.view}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onChangeSlotView(slot.id, e.target.value as AxoViewKey)}
                    >
                      {AXO_VIEWS.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </div>
              <button
                className="absolute cursor-text"
                style={{ left: tagX, top: tagY, width: Math.max(0, tagW), height: Math.max(0, tagH) }}
                onClick={() => setEditingSlotId(slot.id)}
                aria-label={`Edit ${tile.name} name tag`}
              />
              {editingSlotId === slot.id && (
                <div className="absolute z-10 flex w-56 max-w-[90vw] flex-col gap-1.5 rounded-md border border-input bg-black/90 p-2 shadow-lg" style={{ left: Math.min(tagX, Math.max(0, geo.widthPx - 224)), top: Math.max(0, tagY - 124) }}>
                  <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    Label text
                    <Input
                      value={slot.labelOverride ?? ""}
                      placeholder="Auto"
                      className="h-6 w-32 text-[10px]"
                      onChange={(e) => onChangeSlot(slot.id, { labelOverride: e.target.value })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    Category
                    <Select
                      className="h-6 w-32 rounded border border-input bg-black px-1 text-[10px] text-white"
                      value={slot.tag?.category ?? ""}
                      onChange={(e) => onChangeSlot(slot.id, { tag: e.target.value ? { category: e.target.value, number: slot.tag?.number ?? resolved.number } : undefined })}
                    >
                      <option value="">Auto ({resolved.category || "none"})</option>
                      {CATALOGUE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    Number
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      disabled={!slot.tag}
                      value={slot.tag?.number ?? ""}
                      placeholder={resolved.number === null ? "-" : String(resolved.number)}
                      className="h-6 w-32 text-[10px]"
                      onChange={(e) => slot.tag && onChangeSlot(slot.id, { tag: { ...slot.tag, number: e.target.value ? Number(e.target.value) : null } })}
                    />
                  </label>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    Text size
                  <Input
                    type="number"
                    min={4}
                    max={200}
                    value={slot.nameFontSizePt ?? ""}
                    placeholder="Auto"
                    className="h-6 w-32 text-[10px]"
                    onChange={(e) => onChangeSlotNameSize(slot.id, e.target.value ? Number(e.target.value) : null)}
                  />
                  </div>
                  <button className="self-end text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setEditingSlotId(null)}>
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
