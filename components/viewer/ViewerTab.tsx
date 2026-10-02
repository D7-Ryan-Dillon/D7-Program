"use client";

import { useMemo, useState } from "react";
import { useProject, useProjectUi } from "@/lib/project-store";
import { usePresets } from "@/lib/presets";
import { newLinkHub, type CameraLink } from "@/lib/cameraLink";
import { UploadZone } from "@/components/viewer/UploadZone";
import { TileSwitcher } from "@/components/shared/TileSwitcher";
import { MetricsPanel, MetricsTable } from "@/components/viewer/MetricsPanel";
import { ExportPanel } from "@/components/viewer/ExportPanel";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { PresetBar } from "@/components/shared/PresetBar";
import { Segmented } from "@/components/shared/Segmented";
import { SyncAllMenu } from "@/components/shared/SyncAllMenu";
import { TilePane, defaultPane, normalizePane, syncPane, type PaneState, type SyncField } from "@/components/shared/TilePane";
import { Section } from "@/components/shared/Section";

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
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <TileSwitcher />

      {!activeTile ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <UploadZone />
          </div>
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] ${count > 1 ? "lg:grid-cols-[260px_minmax(0,1fr)_380px]" : "lg:grid-cols-[260px_minmax(0,1fr)_280px]"}`}
        >
          <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
            <GlowPanel glow="orange">
              <div className="space-y-3 p-4">
                <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Viewports</div>
                <Segmented value={layout} options={[{ value: 1, label: "1" }, { value: 2, label: "2 side by side" }, { value: 4, label: "4 grid" }]} onChange={(l) => setUi((prev) => ({ ...prev, layout: l as Layout }))} />
                {count > 1 && (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={match} onChange={(e) => setUi((prev) => ({ ...prev, match: e.target.checked }))} />
                      Match cameras (orbit one, all follow)
                    </label>
                    <SyncAllMenu count={count} onSync={syncAll} />
                  </>
                )}
                <p className="text-[10px] text-muted-foreground">Each viewport has its own view, display, visibility, opacity, clipping and rotation -- the buttons under it.</p>
              </div>
            </GlowPanel>
            <GlowPanel glow="magenta">
              <div className="p-4">
                <PresetBar<ViewerPresetData>
                  label="Viewport presets"
                  presets={presets.presets}
                  onSave={(name) => presets.save(name, presetData())}
                  onUpdate={(id) => presets.update(id, presetData())}
                  onRename={presets.rename}
                  onRemove={presets.remove}
                  onApply={(p) => applyPreset(p.data)}
                />
              </div>
            </GlowPanel>
          </div>

          {/* Pinned to the top while the controls scroll on phones / half-screen laptops. */}
          <div className="order-1 min-w-0 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-none lg:min-h-0">
            {count === 1 ? (
              <div className="h-[46vh] lg:h-full">{renderPane(0)}</div>
            ) : (
              <div className={`grid h-[54vh] gap-2 lg:h-full ${count === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2"}`}>
                {paneIndexes.map((i) => (
                  <div key={i} className="min-h-0 min-w-0">
                    {renderPane(i)}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
            <GlowPanel className="flex-1" glow="magenta">
              <div className="p-4">
                {count > 1 ? <MetricsTable tiles={shownTiles} /> : <MetricsPanel tile={activeTile} />}
                <div className="mt-4">
                  <Section id="viewer.export" variant="inline" title="Export (OBJ / analysis)">
                    <ExportPanel tile={activeTile} visibility={panes[0].visibility} />
                  </Section>
                </div>
              </div>
            </GlowPanel>
          </div>
        </div>
      )}
    </div>
  );
}
