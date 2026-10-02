"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TilePicker } from "./TilePicker";
import { SlotOrderList } from "./SlotOrderList";
import { BoardSettingsPanel } from "./BoardSettingsPanel";
import { AnimatedExportPanel } from "./AnimatedExportPanel";
import { BoardPreviewCanvas } from "./BoardPreviewCanvas";
import { TileViewEditor } from "./TileViewEditor";
import { downloadBlob, exportBoardPage1, exportBoardPage2 } from "@/lib/boards/exportBoard";
import { DEFAULT_AXO_VIEW, defaultBoardConfig, type AnimationSettings, type AxoViewKey, type BoardSlot, type BoardSlotOverrides } from "@/lib/boards/types";

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
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [animOpen, setAnimOpen] = useState(false);
  const [animBusy, setAnimBusy] = useState(false);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 800, height: 600 });

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    const PADDING = 16; // p-2 on both sides on phones (p-4 / 32 from sm up -- close enough for a fit calculation)
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

  const patchAnimation = (patch: Partial<AnimationSettings>) => setConfig((prev) => ({ ...prev, animation: { ...prev.animation, ...patch } }));

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

  const changeSlotOverrides = (slotId: string, overrides: BoardSlotOverrides | undefined) => {
    setConfig((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, overrides } : s)) }));
  };

  const moveSlot = (slotId: string, direction: "up" | "down") => {
    setConfig((prev) => {
      const index = prev.slots.findIndex((s) => s.id === slotId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= prev.slots.length) return prev;
      const slots = [...prev.slots];
      [slots[index], slots[targetIndex]] = [slots[targetIndex], slots[index]];
      return { ...prev, slots };
    });
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
    <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)]">
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="p-4">
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Board order</div>
            <SlotOrderList slots={config.slots} tileById={tileById} onMove={moveSlot} onRemove={removeSlot} />
            <Separator className="my-4" />
            <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Tiles</div>
            <TilePicker slots={config.slots} onToggle={toggleTile} />
          </div>
        </GlowPanel>
      </div>

      <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-none lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
        <div ref={previewAreaRef} className="flex h-[70vh] items-center justify-center overflow-auto rounded-lg border-hair bg-black/40 p-2 sm:p-4 lg:h-auto lg:min-h-0 lg:flex-1">
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
                onEditSlot={setEditingSlotId}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Check tiles on the left to add them to the board.</div>
          )}
        </div>
      </div>

      <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="p-4">
            <button
              type="button"
              aria-expanded={animOpen}
              onClick={() => setAnimOpen((o) => !o)}
              className="flex w-full items-center justify-between font-mono text-[11px] tracking-label uppercase text-muted-foreground hover:text-foreground"
            >
              <span>Animated export (GIF / MP4){animBusy ? " — running…" : ""}</span>
              <ChevronDown className={`size-4 transition-transform ${animOpen ? "rotate-180" : ""}`} />
            </button>
            {/* Kept mounted while closed so an export in progress is not lost. */}
            <div className={animOpen ? "mt-3" : "hidden"}>
              <AnimatedExportPanel config={config} tileById={tileById} onChange={patchAnimation} onBusyChange={setAnimBusy} />
            </div>
          </div>
        </GlowPanel>
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

      {editingSlotId &&
        (() => {
          const slot = config.slots.find((s) => s.id === editingSlotId);
          const tile = slot?.tileId ? tileById.get(slot.tileId) : undefined;
          if (!slot || !tile) return null;
          return (
            <TileViewEditor
              tile={tile}
              slot={slot}
              config={config}
              onSave={(overrides) => changeSlotOverrides(slot.id, overrides)}
              onClose={() => setEditingSlotId(null)}
            />
          );
        })()}
    </div>
  );
}
