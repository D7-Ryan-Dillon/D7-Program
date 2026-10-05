"use client";

import { useMemo, useState } from "react";
import { useProject, useProjectUi } from "@/lib/project-store";
import { usePresets } from "@/lib/presets";
import { newLinkHub, type CameraLink } from "@/lib/cameraLink";
import { useCriteria } from "@/lib/useCriteria";
import { scoreTileCached } from "@/lib/scoring/selection";
import { compareSentence } from "@/lib/scoring/compare";
import type { DescriptorKey, DescriptorResult } from "@/lib/scoring/descriptors";
import { ResultsPanel } from "@/components/analysis/ResultsPanel";
import { UploadZone } from "@/components/viewer/UploadZone";
import { DescriptorCard } from "@/components/analysis/DescriptorCard";
import { CriteriaPanel } from "@/components/analysis/CriteriaPanel";
import { PresetBar } from "@/components/shared/PresetBar";
import { Segmented } from "@/components/shared/Segmented";
import { Section } from "@/components/shared/Section";
import { useShortcuts } from "@/lib/shortcuts";
import { SyncAllMenu } from "@/components/shared/SyncAllMenu";
import { TilePane, defaultPane, normalizePane, syncPane, type PaneState, type SyncField } from "@/components/shared/TilePane";
import type { ParsedTile } from "@/lib/types";

/** An axo corner, slowly turning -- the Analysis viewports' default. */
const analysisPane = (): PaneState => ({ ...defaultPane(true), view: "iso-top-ne" });
const normalizeAnalysisPane = (p: Partial<PaneState> | undefined) => normalizePane({ view: "iso-top-ne", ...p }, true);

/** Everything about the Analysis tab that is remembered per project. */
interface AnalysisUi {
  mode: "single" | "compare";
  /** Compare columns: always 2, optionally a 3rd (shown only on wide screens). */
  count: 2 | 3;
  match: boolean;
  single: PaneState;
  panes: PaneState[];
}
const defaultAnalysisUi = (): AnalysisUi => ({ mode: "single", count: 2, match: false, single: analysisPane(), panes: [analysisPane(), analysisPane(), analysisPane()] });

interface ComparePresetData {
  count: 2 | 3;
  match: boolean;
  panes: PaneState[];
}

export function AnalysisTab() {
  const { tiles, activeTileId } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];
  const [ui, setUi] = useProjectUi<AnalysisUi>("analysis", defaultAnalysisUi);
  const { mode, count, match } = ui;
  const single = useMemo(() => normalizeAnalysisPane(ui.single), [ui.single]);
  const panes = useMemo(() => ui.panes.map(normalizeAnalysisPane), [ui.panes]);
  const { keys: carriedKeys } = useCriteria();
  /** Which card's evidence the views are lighting (pane 0 is the single viewport). */
  const [evidence, setEvidence] = useState<{ pane: number; key: DescriptorKey } | null>(null);
  const toggleEvidence = (pane: number, key: DescriptorKey) => setEvidence((prev) => (prev && prev.pane === pane && prev.key === key ? null : { pane, key }));
  const evidenceOf = (pane: number, rs: DescriptorResult[]) => (evidence && evidence.pane === pane ? rs.find((r) => r.key === evidence.key)?.evidence : undefined);
  const presets = usePresets<ComparePresetData>("compare");
  const [hub] = useState(newLinkHub);

  const activeIndex = Math.max(0, tiles.findIndex((t) => t.id === activeTile?.id));
  const compareTile = (i: number): ParsedTile | undefined => tiles.find((t) => t.id === panes[i].tileId) ?? tiles[(activeIndex + i) % Math.max(tiles.length, 1)];
  const compareTiles = [0, 1, 2].slice(0, count).map(compareTile);

  const results = useMemo(() => (activeTile ? scoreTileCached(activeTile) : []), [activeTile]);
  // scoreTileCached memoizes per tile, so this is cheap to redo on every render.
  const compareResults = compareTiles.map((t) => (t ? scoreTileCached(t) : []));

  const patchSingle = (patch: Partial<PaneState>) => setUi((prev) => ({ ...prev, single: { ...normalizeAnalysisPane(prev.single), ...patch } }));
  /** One setting copied onto every compared viewport. */
  const applyAll = (patch: Partial<PaneState>) => setUi((prev) => ({ ...prev, panes: prev.panes.map((p) => ({ ...normalizeAnalysisPane(p), ...patch, tileId: p.tileId })) }));
  const syncAll = (source: number, fields: SyncField[]) =>
    setUi((prev) => {
      const norm = prev.panes.map(normalizeAnalysisPane);
      return { ...prev, panes: norm.map((p, k) => (k === source ? p : syncPane(p, norm[source], fields))) };
    });
  const patchPane = (i: number, patch: Partial<PaneState>) =>
    setUi((prev) => ({
      ...prev,
      panes: prev.panes.map((raw, k) => {
        const p = normalizeAnalysisPane(raw);
        if (k === i) return { ...p, ...patch };
        return prev.match && ("view" in patch || "autoRotate" in patch || "rotateSecs" in patch) ? { ...p, view: patch.view ?? p.view, autoRotate: patch.autoRotate ?? p.autoRotate, rotateSecs: patch.rotateSecs ?? p.rotateSecs } : p;
      }),
    }));

  const linkFor = (i: number): CameraLink | undefined => (match ? { id: `cmp-${i}`, hub, leader: i === 0 } : undefined);
  useShortcuts("analysis", [
    { keys: "S", label: "Single tile", group: "View", run: () => setUi((prev) => ({ ...prev, mode: "single" })) },
    { keys: "C", label: "Compare tiles", group: "View", run: () => setUi((prev) => ({ ...prev, mode: "compare" })) },
    ...(mode === "compare"
      ? [
          { keys: "M", label: match ? "Unmatch cameras" : "Match cameras", group: "Compare", run: () => setUi((prev) => ({ ...prev, match: !prev.match })) },
          { keys: "3", label: count === 3 ? "Two tiles" : "Three tiles", group: "Compare", run: () => setUi((prev) => ({ ...prev, count: prev.count === 3 ? 2 : 3 })) },
        ]
      : []),
  ]);

  if (!activeTile) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-xl">
          <UploadZone />
        </div>
      </div>
    );
  }

  const applyPreset = (d: ComparePresetData) => setUi((prev) => ({ ...prev, mode: "compare", count: d.count, match: d.match, panes: d.panes }));
  const presetData = (): ComparePresetData => ({
    count,
    match,
    panes: panes.map((p, i) => ({ ...p, tileId: compareTile(i)?.id ?? p.tileId })),
  });

  const modeBar = (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented value={mode} options={[{ value: "single", label: "Single" }, { value: "compare", label: "Compare" }]} onChange={(m) => setUi((prev) => ({ ...prev, mode: m }))} />
      {mode === "compare" && tiles.length > 1 && (
        <>
          <span className="hidden xl:inline-flex">
            <Segmented value={count} options={[{ value: 2, label: "2 tiles" }, { value: 3, label: "3 tiles" }]} onChange={(c) => setUi((prev) => ({ ...prev, count: c as 2 | 3 }))} />
          </span>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={match} onChange={(e) => setUi((prev) => ({ ...prev, match: e.target.checked }))} />
            Match cameras
          </label>
          <SyncAllMenu count={count} onSync={syncAll} />
        </>
      )}
    </div>
  );

  if (mode === "single") {
    return (
      <div className="flex flex-col gap-4">
        {modeBar}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
          {/* The tile you are reading stays in view: pinned to the top on narrow screens, beside the cards on wide ones. */}
          <div className="sticky top-0 z-20 self-start bg-background/95 pb-2 lg:top-0">
            <div className="h-[44vh] w-full lg:h-[min(64vh,560px)]">
              <TilePane tile={activeTile} pane={single} onPane={patchSingle} emphasis={evidenceOf(0, results)} />
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-3">
              <div className="text-base font-medium">{activeTile.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">scored against all twelve studio descriptors · id {activeTile.id}</div>
            </div>
            <div className="glass-panel rounded-lg">
              <Section id="analysis.descriptors" title={`Descriptors (${results.length})`} summary={`${carriedKeys.length} carried`}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {results.map((r) => (
                    <DescriptorCard key={r.key} result={r} carried={carriedKeys.includes(r.key)} evidenceOn={evidence?.pane === 0 && evidence.key === r.key} onEvidence={() => toggleEvidence(0, r.key)} />
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </div>
        <CriteriaPanel />
        <ResultsPanel tiles={tiles} keys={carriedKeys} activeTile={activeTile} />
      </div>
    );
  }

  const visibleCols = compareTiles.length;
  const gridCols = count === 3 ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2";
  const rowCols = count === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2";

  return (
    <div className="flex flex-col gap-4">
      {modeBar}
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-full max-w-md">
          <PresetBar<ComparePresetData>
            label="Compare presets"
            presets={presets.presets}
            onSave={(name) => presets.save(name, presetData())}
            onUpdate={(id) => presets.update(id, presetData())}
            onRename={presets.rename}
            onRemove={presets.remove}
            onApply={(p) => applyPreset(p.data)}
          />
        </div>
      </div>

      {/* The compared tiles stay pinned to the top while their numbers scroll underneath. */}
      <div className={`sticky top-0 z-20 grid gap-2 bg-background/95 pb-2 ${gridCols}`}>
        {compareTiles.map((tile, i) =>
          tile ? (
            <div key={i} className={`h-[38vh] min-h-[240px] lg:h-[46vh] ${i === 2 ? "max-xl:hidden" : ""}`}>
              <TilePane
                index={i + 1}
                tile={tile}
                pane={panes[i]}
                onPane={(patch) => patchPane(i, patch)}
                tileChoices={tiles}
                onPickTile={(id) => patchPane(i, { tileId: id })}
                link={linkFor(i)}
                compact
                onApplyAll={applyAll}
                emphasis={evidenceOf(i, compareResults[i])}
              />
            </div>
          ) : null,
        )}
      </div>

      <div className="glass-panel rounded-lg">
      <Section id="analysis.compare" title={`Descriptors (${(compareResults[0] ?? []).length})`} summary={`${carriedKeys.length} carried`}>
      <div className="space-y-3">
        {(compareResults[0] ?? []).map((_, d) => {
          const row = compareResults.map((r) => r[d]).filter(Boolean);
          const scores = row.map((r) => r.score);
          const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
          const hi = scores.indexOf(Math.max(...scores));
          const lo = scores.indexOf(Math.min(...scores));
          return (
            <div key={row[0].key} className={`grid grid-cols-1 gap-3 ${rowCols}`}>
              {row.map((r, i) => (
                <div key={i} className={i === 2 ? "max-xl:hidden" : ""}>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground md:hidden">{compareTiles[i]?.name}</div>
                  <DescriptorCard
                    result={r}
                    carried={carriedKeys.includes(r.key)}
                    mark={spread >= 25 && i === hi ? "high" : spread >= 25 && i === lo ? "low" : null}
                    spread={spread}
                    evidenceOn={evidence?.pane === i && evidence.key === r.key}
                    onEvidence={() => toggleEvidence(i, r.key)}
                  />
                </div>
              ))}
              {row.length > 1 && (
                <p className="text-xs leading-relaxed text-muted-foreground md:col-span-full">
                  {compareSentence(row.map((r, i) => ({ tile: compareTiles[i]!, result: r })).filter((e) => e.tile))}
                </p>
              )}
            </div>
          );
        })}
        {visibleCols < 2 && <p className="text-xs text-muted-foreground">Load a second tile to compare.</p>}
      </div>
      </Section>
      </div>

      <CriteriaPanel />
      <ResultsPanel tiles={tiles} keys={carriedKeys} activeTile={activeTile} />
    </div>
  );
}
