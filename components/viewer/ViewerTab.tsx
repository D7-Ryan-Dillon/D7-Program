"use client";

import { useMemo, useState } from "react";
import { useProject, useProjectUi } from "@/lib/project-store";
import { usePresets } from "@/lib/presets";
import { newLinkHub, type CameraLink } from "@/lib/cameraLink";
import { UploadZone } from "@/components/viewer/UploadZone";
import { MetricsPanel, MetricsTable } from "@/components/viewer/MetricsPanel";
import { ExportPanel } from "@/components/viewer/ExportPanel";
import { PrintPanel } from "@/components/viewer/PrintPanel";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { PresetBar } from "@/components/shared/PresetBar";
import { Segmented } from "@/components/shared/Segmented";
import { SyncAllMenu } from "@/components/shared/SyncAllMenu";
import { TilePane, defaultPane, normalizePane, syncPane, type PaneState, type SyncField } from "@/components/shared/TilePane";
import { PaneMenu } from "@/components/shared/PaneMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bookmark, Download, PanelRight, Printer } from "lucide-react";
import { PrintBatchDialog } from "@/components/viewer/PrintBatchDialog";
import { useSectionOpen } from "@/lib/workspaceUi";
import { useShortcuts } from "@/lib/shortcuts";

type Layout = 1 | 2 | 4;

/** Everything about the Viewer that is remembered per project. Every
 * viewport carries its own view, display mode, visibility, opacity, clipping
 * and rotation (see PaneState). */
interface ViewerUi {
  layout: Layout;
  /** Orbiting one viewport moves them all. */
  match: boolean;
  panes: PaneState[];
}
const defaultViewerUi = (): ViewerUi => ({
  layout: 1,
  match: false,
  panes: [defaultPane(), defaultPane(), defaultPane(), defaultPane()],
});

interface ViewerPresetData {
  layout: Layout;
  match: boolean;
  panes: PaneState[];
}

/** Settings that follow the view when cameras are matched. */
const MATCHED_KEYS: (keyof PaneState)[] = ["view", "autoRotate", "rotateSecs"];

export function ViewerTab() {
  const { tiles, activeTileId, setActiveTile } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];
  const [ui, setUi] = useProjectUi<ViewerUi>("viewer", defaultViewerUi);
  const { layout, match } = ui;
  const panes = useMemo(() => ui.panes.map((p) => normalizePane(p)), [ui.panes]);
  const presets = usePresets<ViewerPresetData>("viewer");
  const [hub] = useState(newLinkHub);
  // the numbers panel and the export window stay out of the way until asked for
  const [infoOpen, setInfoOpen] = useSectionOpen("viewer.info", false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const count = layout;
  const activeIndex = Math.max(0, tiles.findIndex((t) => t.id === activeTile?.id));

  /** The tile pane i shows: pane 0 follows the tile bar; the rest keep their own pick, defaulting to the tiles after it. */
  const tileFor = (i: number) => {
    if (i === 0) return activeTile;
    return tiles.find((t) => t.id === panes[i].tileId) ?? tiles[(activeIndex + i) % tiles.length];
  };

  const patchPane = (i: number, patch: Partial<PaneState>) =>
    setUi((prev) => ({
      ...prev,
      panes: prev.panes.map((raw, k) => {
        const p = normalizePane(raw);
        if (k === i) return { ...p, ...patch };
        // With matched cameras the view and auto-rotate follow every viewport.
        if (prev.match && MATCHED_KEYS.some((key) => key in patch)) {
          const follow: Partial<PaneState> = {};
          for (const key of MATCHED_KEYS) if (key in patch) Object.assign(follow, { [key]: patch[key] });
          return { ...p, ...follow };
        }
        return p;
      }),
    }));

  /** One setting copied onto every viewport. */
  const applyAll = (patch: Partial<PaneState>) => setUi((prev) => ({ ...prev, panes: prev.panes.map((p) => ({ ...normalizePane(p), ...patch, tileId: p.tileId })) }));
  const syncAll = (source: number, fields: SyncField[]) =>
    setUi((prev) => {
      const norm = prev.panes.map((p) => normalizePane(p));
      return { ...prev, panes: norm.map((p, k) => (k === source ? p : syncPane(p, norm[source], fields))) };
    });

  const linkFor = (i: number): CameraLink | undefined => (match && count > 1 ? { id: `pane-${i}`, hub, leader: i === 0 } : undefined);
  const setDraw = (mode: "model" | "plan" | "section") => patchPane(0, { draw: { ...panes[0].draw, mode } });
  useShortcuts("viewer", [
    { keys: "1", label: "One viewport", group: "Viewports", run: () => setUi((prev) => ({ ...prev, layout: 1 })) },
    { keys: "2", label: "Two viewports", group: "Viewports", run: () => setUi((prev) => ({ ...prev, layout: 2 })) },
    { keys: "4", label: "Four viewports", group: "Viewports", run: () => setUi((prev) => ({ ...prev, layout: 4 })) },
    { keys: "M", label: match ? "Unmatch cameras" : "Match cameras", group: "Viewports", run: () => setUi((prev) => ({ ...prev, match: !prev.match })) },
    { keys: "3", label: "3D model", group: "First viewport", run: () => setDraw("model") },
    { keys: "P", label: "Plan", group: "First viewport", run: () => setDraw("plan") },
    { keys: "S", label: "Section", group: "First viewport", run: () => setDraw("section") },
    { keys: "G", label: panes[0].displayMode === "ghosted" ? "Rendered" : "Ghosted", group: "First viewport", run: () => patchPane(0, { displayMode: panes[0].displayMode === "ghosted" ? "rendered" : "ghosted" }) },
    { keys: "R", label: "Auto-rotate", group: "First viewport", run: () => patchPane(0, { autoRotate: !panes[0].autoRotate }) },
    { keys: "I", label: infoOpen ? "Hide the numbers" : "Show the numbers", group: "View", run: () => setInfoOpen(!infoOpen) },
    { keys: "Ctrl+E", label: "Export", group: "Output", run: () => activeTile && setExportOpen(true) },
    { keys: "Ctrl+P", label: "3D print blocks", group: "Output", run: () => activeTile && setPrintOpen(true) },
  ]);
  const paneIndexes = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  const shownTiles = paneIndexes.map(tileFor).filter((t): t is NonNullable<typeof t> => !!t);

  const presetData = (): ViewerPresetData => ({ layout, match, panes });
  const applyPreset = (d: ViewerPresetData) => {
    setUi((prev) => ({ ...prev, layout: d.layout, match: d.match, panes: d.panes.map((p) => normalizePane(p)) }));
    // Pane 0 follows the tile bar, so restore its tile through the bar.
    const first = d.panes[0]?.tileId;
    if (first && tiles.some((t) => t.id === first)) setActiveTile(first);
  };

  const renderPane = (i: number) => {
    const tile = tileFor(i);
    if (!tile) return null;
    return (
      <TilePane
        key={i}
        index={i + 1}
        tile={tile}
        pane={panes[i]}
        onPane={(patch) => patchPane(i, patch)}
        tileChoices={tiles.length > 1 ? tiles : undefined}
        onPickTile={(id) => {
          if (i === 0) setActiveTile(id);
          else patchPane(i, { tileId: id });
        }}
        link={linkFor(i)}
        compact={count > 1}
        onApplyAll={count > 1 ? applyAll : undefined}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      {!activeTile ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <UploadZone />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={layout} options={[{ value: 1, label: "1" }, { value: 2, label: "2" }, { value: 4, label: "4" }]} onChange={(l) => setUi((prev) => ({ ...prev, layout: l as Layout }))} />
            {count > 1 && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="accent-[var(--magenta)]" checked={match} onChange={(e) => setUi((prev) => ({ ...prev, match: e.target.checked }))} />
                  Match cameras
                </label>
                <SyncAllMenu count={count} onSync={syncAll} />
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <PaneMenu icon={Bookmark} label="Presets" side="bottom" width="w-72">
                <PresetBar<ViewerPresetData>
                  label="Viewport presets"
                  presets={presets.presets}
                  onSave={(name) => presets.save(name, presetData())}
                  onUpdate={(id) => presets.update(id, presetData())}
                  onRename={presets.rename}
                  onRemove={presets.remove}
                  onApply={(p) => applyPreset(p.data)}
                />
              </PaneMenu>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setPrintOpen(true)} title="Print several blocks at once, each with a label in its underside (Ctrl+P)">
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                3D print
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setExportOpen(true)} title="Print, OBJ and analysis files (Ctrl+E)">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
              <button
                type="button"
                aria-label={infoOpen ? "Hide the numbers" : "Show the numbers"}
                title={infoOpen ? "Hide the numbers (I)" : "Show the numbers (I)"}
                onClick={() => setInfoOpen(!infoOpen)}
                className={`flex h-7 items-center gap-1 rounded-md border-hair px-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground ${infoOpen ? "border-magenta/50 bg-magenta/10 text-foreground" : ""}`}
              >
                <PanelRight className="h-3.5 w-3.5" />
                Info
              </button>
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] ${infoOpen ? (count > 1 ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "lg:grid-cols-[minmax(0,1fr)_300px]") : ""}`}>
            {/* Pinned to the top while the controls scroll on phones / half-screen laptops. */}
            <div className="order-1 min-w-0 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-none lg:min-h-0">
              {count === 1 ? (
                <div className="h-[56vh] lg:h-full">{renderPane(0)}</div>
              ) : (
                <div className={`grid h-[60vh] gap-2 lg:h-full ${count === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2"}`}>
                  {paneIndexes.map((i) => (
                    <div key={i} className="min-h-0 min-w-0">
                      {renderPane(i)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {infoOpen && (
              <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
                <GlowPanel className="flex-1" glow="magenta">
                  <div className="p-4">{count > 1 ? <MetricsTable tiles={shownTiles} /> : <MetricsPanel tile={activeTile} onShowLevel={(level) => patchPane(0, { draw: { ...panes[0].draw, mode: "plan", level } })} />}</div>
                </GlowPanel>
              </div>
            )}
          </div>

          <PrintBatchDialog open={printOpen} onOpenChange={setPrintOpen} />
          <Dialog open={exportOpen} onOpenChange={setExportOpen}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Export {activeTile.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Print (STL)</div>
                  <PrintPanel tile={activeTile} />
                </div>
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Models and analysis</div>
                  <ExportPanel tile={activeTile} visibility={panes[0].visibility} />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
