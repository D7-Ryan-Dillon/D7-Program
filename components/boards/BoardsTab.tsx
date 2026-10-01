"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TilePicker } from "./TilePicker";
import { BoardSettingsPanel } from "./BoardSettingsPanel";
import { BoardPreviewCanvas } from "./BoardPreviewCanvas";
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
  const [previewPage, setPreviewPage] = useState<1 | 2>(1);
  const [exporting, setExporting] = useState(false);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 800, height: 600 });

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    const PADDING = 32; // p-4 on both sides
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setPreviewAreaSize({ width: Math.max(0, rect.width - PADDING), height: Math.max(0, rect.height - PADDING) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit the board's own aspect ratio inside the available area -- whichever
  // axis is tighter wins, exactly like `object-fit: contain` -- computed in
  // JS (not CSS aspect-ratio) because an aspect-ratio box whose own child
  // sizes itself as a percentage of that box has no way to resolve both
  // axes at once and collapses to zero.
  const boardRatio = config.widthIn / config.heightIn;
  const fitWidth = Math.min(previewAreaSize.width, previewAreaSize.height * boardRatio);
  const fitHeight = fitWidth / boardRatio;

  const patchConfig = (patch: Partial<typeof config>) => setConfig((prev) => ({ ...prev, ...patch }));

  const toggleTile = (tileId: string) => {
    setConfig((prev) => {
      const existingIndex = prev.slots.findIndex((s) => s.tileId === tileId);
      if (existingIndex >= 0) {
        return { ...prev, slots: prev.slots.filter((_, i) => i !== existingIndex) };
      }
      const slot: BoardSlot = { id: newSlotId(), tileId, view: DEFAULT_AXO_VIEW, nameFontSizePt: null };
      return { ...prev, slots: [...prev.slots, slot] };
    });
  };

  const removeSlot = (slotId: string) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.filter((s) => s.id !== slotId) }));
  };

  const changeSlotView = (slotId: string, view: AxoViewKey) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, view } : s)) }));
  };

  const changeSlotNameSize = (slotId: string, nameFontSizePt: number | null) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, nameFontSizePt } : s)) }));
  };

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
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">
              {config.slots.length} tile(s)
              {config.textBox.enabled ? " + caption" : ""}
            </div>
            <div className="inline-flex rounded-full border-hair p-0.5">
              {([1, 2] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreviewPage(p)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] tracking-label uppercase transition-colors ${
                    previewPage === p ? "bg-gradient-to-r from-magenta to-orange text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Page {p}
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" disabled={!config.slots.length || exporting} onClick={() => void exportPngs()}>
            {exporting ? "Exporting…" : "Export PNGs"}
          </Button>
        </div>
        <div ref={previewAreaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border-hair bg-black/40 p-4">
          {config.slots.length ? (
            // Visible only here on screen (never baked into the exported PNG) so an
            // all-black board doesn't disappear into the app's own dark background.
            <div className="rounded-sm border border-white/15" style={{ width: fitWidth, height: fitHeight }}>
              <BoardPreviewCanvas
                config={config}
                tileById={tileById}
                page={previewPage}
                onRemoveSlot={removeSlot}
                onChangeSlotView={changeSlotView}
                onChangeSlotNameSize={changeSlotNameSize}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Check tiles on the left to add them to the board.</div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <GlowPanel glow="orange" className="flex-1">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Board settings</div>
            <BoardSettingsPanel config={config} onChange={patchConfig} />
            <Separator className="my-4" />
            <p className="text-[11px] text-muted-foreground">
              Exports two PNGs: the board itself, and a second page showing each tile&rsquo;s scored descriptors with its top 3 highlighted. Click a tile&rsquo;s
              name on the board to set its own text size.
            </p>
          </div>
        </GlowPanel>
      </div>
    </div>
  );
}
