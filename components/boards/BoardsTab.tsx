"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TilePicker } from "./TilePicker";
import { BoardSettingsPanel } from "./BoardSettingsPanel";
import { TileSlotCard } from "./TileSlotCard";
import { gridLayoutFor } from "@/lib/boards/grid";
import { cutCornerClipPathPercent } from "@/lib/boards/cutCorner";
import { downloadBlob, exportBoardPage1, exportBoardPage2 } from "@/lib/boards/exportBoard";
import { DEFAULT_AXO_VIEW, defaultBoardConfig, type AxoViewKey, type BoardSlot } from "@/lib/boards/types";

let slotCounter = 0;
function newSlotId() {
  slotCounter += 1;
  return `slot-${slotCounter}`;
}

export function BoardsTab() {
  const { tiles } = useProject();
  const [config, setConfig] = useState(defaultBoardConfig);

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const totalCells = config.slots.length + (config.textBox.enabled ? 1 : 0);
  const { columns, rows } = gridLayoutFor(totalCells || 1);

  const patchConfig = (patch: Partial<typeof config>) => setConfig((prev) => ({ ...prev, ...patch }));

  const toggleTile = (tileId: string) => {
    setConfig((prev) => {
      const existingIndex = prev.slots.findIndex((s) => s.tileId === tileId);
      if (existingIndex >= 0) {
        return { ...prev, slots: prev.slots.filter((_, i) => i !== existingIndex) };
      }
      const slot: BoardSlot = { id: newSlotId(), tileId, view: DEFAULT_AXO_VIEW };
      return { ...prev, slots: [...prev.slots, slot] };
    });
  };

  const removeSlot = (slotId: string) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.filter((s) => s.id !== slotId) }));
  };

  const changeSlotView = (slotId: string, view: AxoViewKey) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, view } : s)) }));
  };

  const [exporting, setExporting] = useState(false);
  const exportPngs = async () => {
    setExporting(true);
    try {
      const [page1, page2] = await Promise.all([exportBoardPage1(config, tileById), exportBoardPage2(config, tileById)]);
      const base = config.name.trim().replace(/[^\w.-]+/g, "_") || "board";
      downloadBlob(`${base}-board.png`, page1);
      downloadBlob(`${base}-descriptors.png`, page2);
      toast.success("Exported both board PNGs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export the board.");
    } finally {
      setExporting(false);
    }
  };

  const aspect = config.widthIn / config.heightIn;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_280px] grid-rows-[minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Tiles</div>
            <TilePicker slots={config.slots} onToggle={toggleTile} />
          </div>
        </GlowPanel>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs text-muted-foreground">
            {config.slots.length} tile(s){config.textBox.enabled ? " + caption" : ""} · {columns}×{rows} grid
          </div>
          <Button size="sm" disabled={!config.slots.length || exporting} onClick={() => void exportPngs()}>
            {exporting ? "Exporting…" : "Export PNGs"}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border-hair bg-black/40 p-4">
          <div
            className="relative flex flex-col gap-3 p-6 shadow-2xl"
            style={{ aspectRatio: `${aspect}`, width: "100%", maxHeight: "100%", backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold uppercase tracking-wide" style={{ color: config.titleColor }}>
                  {config.name}
                </div>
              </div>
            </div>
            {totalCells ? (
              <div
                className="grid flex-1 gap-3"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
              >
                {config.textBox.enabled && (
                  <div
                    className="flex items-start border px-2 py-1.5 text-xs"
                    style={{ color: config.textBox.color, borderColor: config.textBox.color, clipPath: cutCornerClipPathPercent() }}
                  >
                    {config.textBox.text || "Caption text…"}
                  </div>
                )}
                {config.slots.map((slot) => {
                  const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
                  if (!tile) return null;
                  return (
                    <TileSlotCard
                      key={slot.id}
                      slot={slot}
                      tile={tile}
                      config={config}
                      onChangeView={(view) => changeSlotView(slot.id, view)}
                      onRemove={() => removeSlot(slot.id)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Check tiles on the left to add them to the board.</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <GlowPanel glow="orange" className="flex-1">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Board settings</div>
            <BoardSettingsPanel config={config} onChange={patchConfig} />
            <Separator className="my-4" />
            <p className="text-[11px] text-muted-foreground">
              Exports two PNGs: the board itself, and a second page listing each tile&rsquo;s scored descriptors with its top 3 highlighted.
            </p>
          </div>
        </GlowPanel>
      </div>
    </div>
  );
}
