"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, Bookmark, Download, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useProject, useProjectUi } from "@/lib/project-store";
import { useShortcuts } from "@/lib/shortcuts";
import { usePresets } from "@/lib/presets";
import { useEvaluation } from "@/lib/useEvaluation";
import { descriptorText as textOf } from "@/lib/scoring/boardText";
import { AnalysisSheetsPanel } from "./AnalysisSheetsPanel";
import { mergeDefaults } from "@/lib/mergeDefaults";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { PresetBar } from "@/components/shared/PresetBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaneMenu } from "@/components/shared/PaneMenu";
import { useSectionOpen } from "@/lib/workspaceUi";
import { TilePicker } from "./TilePicker";
import { SlotOrderList } from "./SlotOrderList";
import { Section } from "@/components/shared/Section";
import { BoardSettingsPanel } from "./BoardSettingsPanel";
import { AnimatedExportPanel } from "./AnimatedExportPanel";
import { BoardPreviewCanvas } from "./BoardPreviewCanvas";
import { TileViewEditor } from "./TileViewEditor";
import { downloadBlob, exportBoardPage1, exportBoardPage2 } from "@/lib/boards/exportBoard";
import { tileSortKey } from "@/lib/boards/tileLabel";
import { DEFAULT_AXO_VIEW, defaultBoardConfig, displayName, type AnimationSettings, type AxoViewKey, type BoardConfig, type BoardSlot, type BoardSlotOverrides } from "@/lib/boards/types";

/** Everything about the Boards tab that is remembered per project. */
interface BoardsUi {
  config: BoardConfig;
  previewPage: 1 | 2;
  animOpen: boolean;
}
const defaultBoardsUi = (): BoardsUi => ({ config: defaultBoardConfig(), previewPage: 1, animOpen: false });

interface BoardPresetData {
  config: BoardConfig;
  withTiles: boolean;
}

function newSlotId() {
  return `slot-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function BoardsTab() {
  const { tiles } = useProject();
  const [ui, setUi] = useProjectUi<BoardsUi>("boards", defaultBoardsUi);
  const { config, previewPage } = ui;
  const criteria = useEvaluation();
  const boardPresets = usePresets<BoardPresetData>("boards");
  const [presetWithTiles, setPresetWithTiles] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [animBusy, setAnimBusy] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDpi, setExportDpi] = useState(300);
  const [settingsOpen, setSettingsOpen] = useSectionOpen("boards.settings", true);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 800, height: 600 });

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  // What gets drawn: the saved board plus the project's carried-forward
  // criteria (which the descriptor page lists) -- the criteria belong to the
  // project, not to any one board, so they are never stored in `config`.
  // The text under each descriptor's bar comes from the same evaluation as the Analysis tab: the measurement with its unit, and its status when it is not a plain measurement.
  const descriptorText = useMemo(() => textOf(criteria.evals), [criteria.evals]);
  const renderConfig = useMemo<BoardConfig>(() => ({ ...config, descriptorKeys: criteria.keys, descriptorText }), [config, criteria.keys, descriptorText]);

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

  const setConfig = (update: (prev: BoardConfig) => BoardConfig) => setUi((prev) => ({ ...prev, config: update(prev.config) }));
  const patchConfig = (patch: Partial<BoardConfig>) => setConfig((prev) => ({ ...prev, ...patch }));
  const patchAnimation = (patch: Partial<AnimationSettings>) => setConfig((prev) => ({ ...prev, animation: { ...prev.animation, ...patch } }));
  const patchSlot = (slotId: string, patch: Partial<BoardSlot>) => setConfig((prev) => ({ ...prev, slots: prev.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)) }));

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

  const removeSlot = (slotId: string) => setConfig((prev) => ({ ...prev, slots: prev.slots.filter((s) => s.id !== slotId) }));
  const changeSlotView = (slotId: string, view: AxoViewKey) => patchSlot(slotId, { view });
  const changeSlotNameSize = (slotId: string, nameFontSizePt: number | null) => patchSlot(slotId, { nameFontSizePt });
  const changeSlotOverrides = (slotId: string, overrides: BoardSlotOverrides | undefined) => patchSlot(slotId, { overrides });

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

  /** Category (gathering, office, lobby), then typology number, then name. */
  const autoSort = () =>
    setConfig((prev) => {
      const keyOf = (s: BoardSlot) => tileSortKey(s.tileId ? (tileById.get(s.tileId)?.name ?? "") : "", s);
      const slots = [...prev.slots].sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
      });
      return { ...prev, slots };
    });

  /** Copies the popup's settings onto the chosen tiles (replacing their own overrides). */
  const copyOverrides = (targetIds: string[], overrides: BoardSlotOverrides | undefined, view?: AxoViewKey) =>
    setConfig((prev) => ({
      ...prev,
      slots: prev.slots.map((s) => {
        if (!targetIds.includes(s.id)) return s;
        const next: BoardSlot = { ...s, overrides: overrides ? { ...overrides } : undefined };
        if (view) next.view = view;
        return next;
      }),
    }));

  const applyPreset = (data: BoardPresetData) =>
    setConfig((prev) => {
      const merged = mergeDefaults(defaultBoardConfig(), data.config);
      return { ...merged, slots: data.withTiles ? merged.slots : prev.slots };
    });

  const presetData = (): BoardPresetData => ({ config: presetWithTiles ? config : { ...config, slots: [] }, withTiles: presetWithTiles });

  const exportPngs = async () => {
    setExporting(true);
    try {
      const [page1, page2] = await Promise.all([exportBoardPage1(renderConfig, tileById, exportDpi), exportBoardPage2(renderConfig, tileById, exportDpi)]);
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

  useShortcuts("boards", [
    { keys: "1", label: "Board page", group: "Preview", run: () => setUi((prev) => ({ ...prev, previewPage: 1 })) },
    { keys: "2", label: "Descriptor page", group: "Preview", run: () => setUi((prev) => ({ ...prev, previewPage: 2 })) },
    { keys: "E", label: "Export both PNGs", group: "Export", run: () => (config.slots.length && !exporting ? void exportPngs() : undefined) },
    { keys: "A", label: "Export window (PNG, GIF, MP4)", group: "Export", run: () => setExportOpen(true) },
  ]);

  return (
    // Height-bounded on wide screens (like the Viewer) so the board stays put and only the side menus scroll.
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <div className={`grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] ${settingsOpen ? "lg:grid-cols-[280px_minmax(0,1fr)_300px]" : "lg:grid-cols-[280px_minmax(0,1fr)]"}`}>
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
        <GlowPanel glow="magenta">
          <div className="space-y-4 p-4">
            <Section
              id="boards.order"
              variant="inline"
              title="Board order"
              summary={`${config.slots.length}`}
              action={
                <button
                  type="button"
                  disabled={config.slots.length < 2}
                  onClick={autoSort}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  title="Sort by category (gathering, office, lobby), then typology number"
                >
                  <ArrowDownAZ className="h-3 w-3" />
                  Auto-sort
                </button>
              }
            >
              <SlotOrderList slots={config.slots} tileById={tileById} onMove={moveSlot} onRemove={removeSlot} onView={(slotId, mode) => patchSlot(slotId, { drawing: mode ? { mode } : undefined })} />
            </Section>
            <Section id="boards.tiles" variant="inline" title="Tiles">
              <TilePicker slots={config.slots} onToggle={toggleTile} />
            </Section>
          </div>
        </GlowPanel>
      </div>

      {/* On phones / half-screen laptops the board stays pinned to the top of the tab so settings changes show live while you scroll the controls. */}
      <div className="order-1 flex min-w-0 flex-col gap-3 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-none lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">
              {config.slots.length} tile(s)
              {(config.textBox.enabled || config.textBox2.enabled) && !config.catalogue.enabled ? " + caption" : ""}
            </div>
            <div className="inline-flex rounded-full border-hair p-0.5">
              {([1, 2] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setUi((prev) => ({ ...prev, previewPage: p }))}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] tracking-label uppercase transition-colors ${
                    previewPage === p ? "bg-gradient-to-r from-magenta to-orange text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Page {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <PaneMenu icon={Bookmark} label="Board presets" side="bottom" width="w-72">
              <PresetBar<BoardPresetData>
                label="Board presets"
                presets={boardPresets.presets}
                onSave={(name) => boardPresets.save(name, presetData())}
                onUpdate={(id) => boardPresets.update(id, presetData())}
                onRename={boardPresets.rename}
                onRemove={boardPresets.remove}
                onApply={(p) => applyPreset(p.data)}
              />
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" className="accent-[var(--magenta)]" checked={presetWithTiles} onChange={(e) => setPresetWithTiles(e.target.checked)} />
                Include the tile selection when saving
              </label>
            </PaneMenu>
            <Button size="sm" disabled={!config.slots.length} onClick={() => setExportOpen(true)} title="PNG, GIF or MP4 (E)">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {animBusy ? "Exporting…" : "Export"}
            </Button>
            <button
              type="button"
              aria-label={settingsOpen ? "Hide the board settings" : "Show the board settings"}
              title={settingsOpen ? "Hide the board settings" : "Show the board settings"}
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`flex h-8 w-8 items-center justify-center rounded-md border-hair text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground ${settingsOpen ? "border-magenta/50 bg-magenta/10 text-foreground" : ""}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div ref={previewAreaRef} className="flex h-[30vh] items-center justify-center overflow-auto rounded-lg border-hair bg-black/40 p-2 sm:p-4 lg:h-auto lg:min-h-0 lg:flex-1">
          {config.slots.length ? (
            // Visible only here on screen (never baked into the exported PNG) so an
            // all-black board doesn't disappear into the app's own dark background.
            <div className="rounded-sm border border-white/15" style={{ width: fitWidth, height: fitHeight }}>
              <BoardPreviewCanvas
                config={renderConfig}
                tileById={tileById}
                page={previewPage}
                onRemoveSlot={removeSlot}
                onChangeSlotView={changeSlotView}
                onChangeSlotNameSize={changeSlotNameSize}
                onChangeSlot={patchSlot}
                onEditSlot={setEditingSlotId}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Check tiles on the left to add them to the board.</div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
          <GlowPanel glow="orange" className="flex-1">
            <div className="p-4">
              <div className="mb-3 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Board settings</div>
              <BoardSettingsPanel config={config} onChange={patchConfig} criteriaCount={criteria.keys.length} />
              <p className="mt-4 text-[11px] text-muted-foreground">Settings save with the project automatically.</p>
            </div>
          </GlowPanel>
        </div>
      )}

      <Dialog open={exportOpen} onOpenChange={(o) => !animBusy && setExportOpen(o)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export the board</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Pictures</div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                Resolution
                <select value={exportDpi} onChange={(e) => setExportDpi(Number(e.target.value))} aria-label="Board resolution" className="h-7 rounded-md border border-input bg-transparent px-2 text-[11px] text-foreground">
                  {[150, 200, 300, 450, 600].map((d) => (
                    <option key={d} value={d} className="bg-background">
                      {d} dpi · {Math.round(config.widthIn * d)} × {Math.round(config.heightIn * d)} px
                    </option>
                  ))}
                </select>
              </label>
              <Button className="w-full justify-start" variant="outline" size="sm" disabled={!config.slots.length || exporting} onClick={() => void exportPngs()}>
                {exporting ? "Exporting…" : "Both pages as PNG (the board and its descriptors)"}
              </Button>
            </div>
            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Animated (GIF / MP4){animBusy ? " — running…" : ""}</div>
              <p className="text-[10px] text-muted-foreground">Width is set below; the height follows the page size ({config.widthIn} × {config.heightIn} in, changed under Board settings → Page).</p>
              <AnimatedExportPanel config={renderConfig} tileById={tileById} onChange={patchAnimation} onBusyChange={setAnimBusy} />
            </div>
            <AnalysisSheetsPanel config={config} dpiFromBoard={exportDpi} />
          </div>
        </DialogContent>
      </Dialog>

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
              otherSlots={config.slots
                .filter((s) => s.id !== slot.id)
                .map((s) => ({ id: s.id, name: displayName((s.tileId ? tileById.get(s.tileId)?.name : undefined) ?? "tile") }))}
              onCopyTo={copyOverrides}
            />
          );
        })()}
    </div>
    </div>
  );
}
