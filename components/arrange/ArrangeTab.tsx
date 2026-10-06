"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Camera, Download, Hand, Maximize, MapPin, MousePointer2, PanelRight, Redo2, Ruler, SlidersHorizontal, Square, SquareDashedMousePointer, Undo2, Layers as LayersIcon } from "lucide-react";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { PaneMenu } from "@/components/shared/PaneMenu";
import { Section } from "@/components/shared/Section";
import { LoadingCover } from "@/components/shared/LoadingCover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { newLinkHub } from "@/lib/cameraLink";
import { useShortcuts } from "@/lib/shortcuts";
import { useSectionOpen } from "@/lib/workspaceUi";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import { ArrangeViewport, type ViewportMode } from "@/components/arrange/ArrangeViewport";
import { ArrangeProvider, useArrange } from "@/components/arrange/useArrange";
import { BankPanel } from "@/components/arrange/BankPanel";
import { GeneratePanel } from "@/components/arrange/GeneratePanel";
import { ProgramPanel } from "@/components/arrange/ProgramPanel";
import { SavedPanel } from "@/components/arrange/SavedPanel";
import { TestsPanel } from "@/components/arrange/TestsPanel";
import { InfoPanel } from "@/components/arrange/InfoPanel";
import { SelectionPanel } from "@/components/arrange/SelectionPanel";
import { HelperPanel } from "@/components/arrange/HelperPanel";
import { SmoothPanel } from "@/components/arrange/SmoothPanel";
import { ExportDialog } from "@/components/arrange/ExportDialog";
import { Chip } from "@/components/arrange/ui";
import { overallScore } from "@/lib/arrange/joints";
import { toFt } from "@/lib/arrange/geometry";
import { cn } from "@/lib/utils";
import type { Vec3 } from "@/lib/arrange/types";
import type { PoseFt } from "@/lib/arrange/capture";
import type { DronePlan } from "@/lib/arrange/drone";

const ToolBtn = ({ label, shortcut, active, onClick, children, disabled }: { label: string; shortcut?: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
  <button type="button" title={shortcut ? `${label} (${shortcut})` : label} aria-label={label} disabled={disabled} onClick={onClick} className={cn("flex h-8 w-8 items-center justify-center rounded-md border-hair text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-40", active && "border-magenta/60 bg-magenta/15 text-foreground")}>
    {children}
  </button>
);

const Opt = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground" title={hint}>
    <span>{label}</span>
    {children}
  </label>
);

function Toolbar({ onExport, panelOpen, onPanel }: { onExport: () => void; panelOpen: boolean; onPanel: () => void }) {
  const A = useArrange();
  const b = A.layout.bounds;
  const frame = useMemo(() => {
    if (!b) return null;
    const c: Vec3 = [toFt((b.min[0] + b.max[0]) / 2), toFt((b.min[1] + b.max[1]) / 2), toFt((b.min[2] + b.max[2]) / 2)];
    return { center: c, radius: Math.max(10, Math.hypot(toFt(b.max[0] - b.min[0]), toFt(b.max[1] - b.min[1]), toFt(b.max[2] - b.min[2])) / 2) };
  }, [b]);

  const pose = (kind: "3d" | "plan" | "section" | "front"): PoseFt | null => {
    if (!frame) return null;
    const R = frame.radius;
    const [x, y, z] = frame.center;
    if (kind === "plan") return { pos: [x + 0.01, y - 0.01, z + R * 2.9], target: frame.center, fov: 36 };
    if (kind === "section") return { pos: [x, y - R * 2.9, z], target: frame.center, fov: 36 };
    if (kind === "front") return { pos: [x + R * 2.9, y, z], target: frame.center, fov: 36 };
    return { pos: [x + R * 1.9, y - R * 1.9, z + R * 1.5], target: frame.center, fov: 38 };
  };
  const go = (k: "3d" | "plan" | "section" | "front") => {
    const p = pose(k);
    if (p) A.viewportApi.current?.setPose(p);
  };
  const levels = A.whole.summary?.levelHeights ?? [];
  const origin = A.whole.comp?.origin[2] ?? 0;
  const none = !A.layout.boxes.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <ToolBtn label="Undo" shortcut="Ctrl+Z" onClick={A.undo} disabled={!A.canUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Redo" shortcut="Ctrl+Shift+Z" onClick={A.redo} disabled={!A.canRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolBtn>
      </div>
      <div className="flex gap-1">
        {(
          [
            ["orbit", "Select and move", "Esc", <MousePointer2 key="o" className="h-3.5 w-3.5" />],
            ["pan", "Pan the view (also right-drag, or hold Space)", "H", <Hand key="p" className="h-3.5 w-3.5" />],
            ["box", "Box select", "B", <SquareDashedMousePointer key="b" className="h-3.5 w-3.5" />],
            ["measure", "Measure", "T", <Ruler key="m" className="h-3.5 w-3.5" />],
            ["entrance", "Mark the entrance", "E", <MapPin key="e" className="h-3.5 w-3.5" />],
          ] as [ViewportMode, string, string, React.ReactNode][]
        ).map(([m, label, key, icon]) => (
          <ToolBtn key={m} label={label} shortcut={key} active={A.mode === m} onClick={() => A.setMode(m)}>
            {icon}
          </ToolBtn>
        ))}
      </div>
      <div className="flex gap-1">
        <PaneMenu icon={Camera} label="View" side="bottom" width="w-60" active={A.levelCut !== null}>
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => go("3d")}>3D</Chip>
            <Chip onClick={() => go("plan")}>Plan</Chip>
            <Chip onClick={() => go("section")}>Section</Chip>
            <Chip onClick={() => go("front")}>Side</Chip>
            <Chip onClick={A.refit}>
              <Maximize className="mr-1 inline h-3 w-3" />
              Fit
            </Chip>
          </div>
          <div className="space-y-1.5 border-t border-border pt-2">
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
              <LayersIcon className="h-3 w-3" />
              Cut at a floor
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={A.levelCut === null} onClick={() => A.setLevelCut(null)}>
                All
              </Chip>
              {levels.slice(0, 8).map((z, i) => (
                <Chip
                  key={i}
                  active={A.levelCut !== null && Math.abs(A.levelCut - (origin + z + 4)) < 0.1}
                  onClick={() => {
                    A.setLevelCut(origin + z + 4);
                    go("plan");
                  }}
                >
                  L{i + 1}
                </Chip>
              ))}
            </div>
          </div>
        </PaneMenu>
        <PaneMenu icon={SlidersHorizontal} label="Display" side="bottom" width="w-72" active={A.ui.smoothOn || A.ui.lattice || A.compare !== "off"}>
          <div className="space-y-2">
            <Opt label="Joint marks (J)">
              <Switch checked={A.ui.showJoints} onCheckedChange={(v) => A.patchUi({ showJoints: v })} />
            </Opt>
            <Opt label="Smooth model" hint="Show the pieces fused into one smooth model (Tools, Smooth and seal)">
              <Switch checked={A.ui.smoothOn} disabled={none} onCheckedChange={(v) => A.patchUi({ smoothOn: v })} />
            </Opt>
            <Opt label="Snap to a 10 ft lattice (Shift+L)" hint="Off: pieces snap to each other's faces, openings and floors">
              <Switch checked={A.ui.lattice} onCheckedChange={(v) => A.patchUi({ lattice: v })} />
            </Opt>
            <Opt label="Auto-rotate" hint="Turns slowly; any touch of the model pauses it for a moment">
              <Switch checked={A.ui.autoRotate} onCheckedChange={(v) => A.patchUi({ autoRotate: v })} />
            </Opt>
            <Opt label="Compare before / after" hint="Two viewports: the model before your last big change and now">
              <Switch checked={A.compare !== "off"} onCheckedChange={(v) => A.setCompare(v ? "side" : "off")} />
            </Opt>
          </div>
          <div className="space-y-2 border-t border-border pt-2">
            <VisibilityPanel parts visibility={A.ui.visibility} onVisibility={(v) => A.patchUi({ visibility: v })} colors={A.ui.colors} onColors={(c) => A.patchUi({ colors: c })} />
            <label className="block text-[11px] text-muted-foreground">
              Foam see-through {Math.round((1 - A.ui.foamOpacity) * 100)}%
              <input type="range" min={0} max={0.95} step={0.01} value={1 - A.ui.foamOpacity} onChange={(e) => A.patchUi({ foamOpacity: 1 - Number(e.target.value) })} className="mt-1 w-full accent-[var(--magenta)]" aria-label="Foam transparency" />
            </label>
          </div>
        </PaneMenu>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <input
          value={A.ui.currentName}
          onChange={(e) => (A.ui.currentId ? A.renameArrangement(A.ui.currentId, e.target.value) : A.patchUi({ currentName: e.target.value }))}
          aria-label="Name of this arrangement"
          title="The name used for the tile and for exported files"
          className="h-8 w-40 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
        />
        <Button size="sm" className="h-8" disabled={none || !!A.busy} onClick={() => void A.addAsTile()} title="Put this arrangement in the tile bank, like any tile">
          <Box className="mr-1.5 h-3.5 w-3.5" />
          Add as tile
        </Button>
        <Button size="sm" variant="outline" className="h-8" disabled={none} onClick={onExport} title="Export (Ctrl+E)">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <ToolBtn label={panelOpen ? "Hide the side panel" : "Show the side panel (Piece, Info, Tools)"} shortcut="\" active={panelOpen} onClick={onPanel}>
          <PanelRight className="h-3.5 w-3.5" />
        </ToolBtn>
      </div>
    </div>
  );
}

function CenterStage({ onExport, panelOpen, onPanel }: { onExport: () => void; panelOpen: boolean; onPanel: () => void }) {
  const A = useArrange();
  const [hub] = useState(newLinkHub);
  const [wipe, setWipe] = useState(50);
  const b = A.layout.bounds;
  const frame = useMemo(() => {
    if (!b) return null;
    const c: Vec3 = [toFt((b.min[0] + b.max[0]) / 2), toFt((b.min[1] + b.max[1]) / 2), toFt((b.min[2] + b.max[2]) / 2)];
    return { center: c, radius: Math.max(10, Math.hypot(toFt(b.max[0] - b.min[0]), toFt(b.max[1] - b.min[1]), toFt(b.max[2] - b.min[2])) / 2) };
  }, [b]);
  const empty = A.shown.pieces.length === 0;
  const score = overallScore(A.joints);
  const compareOn = A.compare !== "off" && !!A.baseline && !A.interlock;

  const common = {
    tileById: A.tileById,
    visibility: A.ui.visibility,
    colors: A.ui.colors,
    foamOpacity: A.ui.foamOpacity,
    levelCut: A.levelCut,
    autoRotate: A.ui.autoRotate,
    autoRotateSpeed: 60 / Math.max(A.ui.rotateSecs, 1),
    fitKey: A.fitKey,
    frame,
  };

  const current = (link?: { id: string; hub: typeof hub; leader: boolean }) => (
    <ArrangeViewport
      {...common}
      pieces={A.shown.pieces}
      joints={A.joints}
      connectors={A.layout.connectors}
      selected={A.sel}
      highlight={A.highlight.size ? A.highlight : compareOn ? A.diff.added : undefined}
      selectedJointId={A.selJoint}
      showJoints={A.ui.showJoints && !compareOn}
      composite={A.ui.smoothOn && !A.interlock && !A.dragging && !compareOn ? A.meshes : null}
      entrancePoint={A.mode === "entrance" ? A.entrance : null}
      site={A.ui.site}
      ghosts={A.ghosts}
      evidence={A.evidence}
      measure={A.measure}
      mode={A.mode}
      hidden={A.viewportHidden ?? undefined}
      pieceAt={A.pieceAt}
      selectionBoxes={A.selectionBoxes}
      onPick={A.pick}
      onPickJoint={(id) => {
        A.setSelJoint(id);
        const j = A.joints.find((x) => x.id === id);
        if (j) A.setHighlight(new Set([j.aId, j.bId]));
      }}
      onBoxSelect={(ids, add) => A.setSel(add ? new Set([...A.sel, ...ids]) : new Set(ids))}
      onMeasurePoint={A.addMeasurePoint}
      onEntrance={(id) => {
        A.setEntrance(id);
        A.setMode("orbit");
      }}
      onDragStart={A.onDragStart}
      onDrag={A.onDrag}
      onDragEnd={A.onDragEnd}
      handleRef={A.viewportHandle}
      apiRef={A.viewportApi}
      link={link}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <Toolbar onExport={onExport} panelOpen={panelOpen} onPanel={onPanel} />
      <div className="relative flex h-[46vh] min-h-0 min-w-0 flex-1 flex-col lg:h-auto">
        {A.loading && <LoadingCover label={A.loading} />}
        {A.interlock && (
          <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-between gap-2 rounded-md border border-magenta/50 bg-black/80 px-3 py-1.5 text-xs">
            <span>
              Interlock preview: <span className="text-pink">{A.interlock.label}</span> (your arrangement is untouched)
            </span>
            <Button size="sm" variant="outline" className="h-6" onClick={() => A.setInterlock(null)}>
              Close
            </Button>
          </div>
        )}
        {A.mode !== "orbit" && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-label text-orange">
            {A.mode === "pan" ? "Pan: drag to move the view" : A.mode === "box" ? "Box select: drag a rectangle" : A.mode === "measure" ? "Measure: click two points (or one for a height)" : "Entrance: click the piece the way in is on"}
          </div>
        )}
        {A.snapNote && <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-label text-pink">snapping: {A.snapNote}</div>}
        {empty ? (
          <div className="glass-panel flex h-full items-center justify-center rounded-lg p-8 text-center text-sm text-muted-foreground">Check tiles in the Bank, then Generate, or click + on a tile to place one by hand.</div>
        ) : compareOn && A.baseline ? (
          A.compare === "side" ? (
            <div className="grid h-full min-h-0 grid-cols-2 gap-2">
              <CompareLabel text="Before">
                <ArrangeViewport {...common} pieces={A.baseline.pieces} joints={[]} selected={new Set()} highlight={A.diff.removed.size ? A.diff.removed : undefined} showJoints={false} mode="orbit" onPick={() => {}} link={{ id: "before", hub, leader: true }} />
              </CompareLabel>
              <CompareLabel text="After">{current({ id: "after", hub, leader: false })}</CompareLabel>
            </div>
          ) : (
            <div className="relative h-full min-h-0">
              <div className="absolute inset-0">{current({ id: "after", hub, leader: false })}</div>
              <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
                <ArrangeViewport {...common} pieces={A.baseline.pieces} joints={[]} selected={new Set()} highlight={A.diff.removed.size ? A.diff.removed : undefined} showJoints={false} mode="orbit" onPick={() => {}} link={{ id: "before", hub, leader: true }} />
              </div>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-white/60" style={{ left: `${wipe}%` }} />
              <input type="range" min={0} max={100} value={wipe} onChange={(e) => setWipe(Number(e.target.value))} aria-label="Wipe between before and after" className="absolute bottom-2 left-1/2 z-10 w-1/2 -translate-x-1/2 accent-[var(--magenta)]" />
            </div>
          )
        ) : (
          current()
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span>
          {A.shown.pieces.length} piece{A.shown.pieces.length === 1 ? "" : "s"}
          {score !== null && <span className="ml-2 text-foreground">· joints {score.toFixed(0)}</span>}
          {A.sel.size > 0 && <span className="ml-2 text-pink">· {A.sel.size} selected</span>}
          {A.baseline && (A.diff.added.size || A.diff.removed.size || A.diff.moved.size) ? <span className="ml-2 text-orange">· {A.diff.added.size} added, {A.diff.removed.size} removed, {A.diff.moved.size} moved</span> : null}
        </span>
        <span className="flex items-center gap-2">
          {A.compare !== "off" && (
            <>
              <Chip active={A.compare === "side"} onClick={() => A.setCompare("side")}>
                Side by side
              </Chip>
              <Chip active={A.compare === "wipe"} onClick={() => A.setCompare("wipe")}>
                Wipe
              </Chip>
              <Chip onClick={A.setBaseline}>Set baseline now</Chip>
              {!A.baseline && <span className="text-orange">no baseline yet: generate, replace or edit, or set one</span>}
            </>
          )}
          <span className={cn(A.valid ? "text-pink" : "text-orange")}>{A.shown.pieces.length === 0 ? "" : A.valid ? "connected" : "needs fixing"}</span>
        </span>
      </div>
    </div>
  );
}

const CompareLabel = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative h-full min-h-0">
    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">{text}</div>
    {children}
  </div>
);

function OrphanDialog() {
  const A = useArrange();
  const p = A.pending;
  const count = p ? p.islands.flat().length : 0;
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && A.resolvePending("cancel")}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>That would cut {count === 1 ? "a piece" : `${count} pieces`} off</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {p?.what}: {count === 1 ? "one piece" : `${count} pieces`} would no longer touch the rest of the building. An arrangement is always one connected mass. What should happen to {count === 1 ? "it" : "them"}?
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => A.resolvePending("cancel")}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => A.resolvePending("reattach")}>
            Re-attach {count === 1 ? "it" : "them"}
          </Button>
          <Button onClick={() => A.resolvePending("remove")}>Remove {count === 1 ? "it" : "them"} too</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Plays a drone tour in the live viewport so it can be judged before it is recorded. */
function TourPlayer({ tour, onStop }: { tour: { plan: DronePlan; seconds: number }; onStop: () => void }) {
  const A = useArrange();
  const api = A.viewportApi;
  const patch = A.patchUi;
  const [u, setU] = useState(0);
  const stop = useRef(onStop);
  useEffect(() => {
    stop.current = onStop;
  });
  useEffect(() => {
    const view = api.current;
    const before = view?.getPose() ?? null;
    // the tour is judged the way it is filmed: no void, solid foam
    const look = { visibility: A.ui.visibility, foamOpacity: A.ui.foamOpacity };
    patch({ visibility: { ...A.ui.visibility, void: false }, foamOpacity: 1 });
    const t0 = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / (tour.seconds * 1000));
      view?.setPose(tour.plan.pose(k, tour.seconds));
      setU(k);
      if (k < 1) id = requestAnimationFrame(tick);
      else setTimeout(() => stop.current(), 600);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      if (before) view?.setPose(before);
      patch(look);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, api]);
  return (
    <div className="fixed bottom-14 left-1/2 z-40 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-lg border-hair bg-black/90 px-3 py-2 text-xs shadow-lg">
      <span className="font-mono text-[10px] uppercase tracking-label text-orange">Drone tour</span>
      <div className="h-1 flex-1 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-gradient-to-r from-magenta to-orange" style={{ width: `${u * 100}%` }} />
      </div>
      <Button size="sm" variant="outline" className="h-6 px-2" onClick={onStop}>
        <Square className="mr-1 h-3 w-3" />
        Stop
      </Button>
    </div>
  );
}

const SIDE_TABS = [
  ["piece", "Piece"],
  ["info", "Info"],
  ["tools", "Tools"],
] as const;
type SideTab = (typeof SIDE_TABS)[number][0];

function ArrangeLayout() {
  const A = useArrange();
  const [exportOpen, setExportOpen] = useState(false);
  const [tour, setTour] = useState<{ plan: DronePlan; seconds: number } | null>(null);
  const [panelOpen, setPanelOpen] = useSectionOpen("arrange.sidepanel", true);
  const [sideTab, setSideTab] = useState<SideTab>("info");
  useShortcuts("arrange", [
    { keys: "Ctrl+E", label: "Export", group: "Output", run: () => A.layout.boxes.length && setExportOpen(true) },
    { keys: "\\", label: panelOpen ? "Hide side panel" : "Show side panel", group: "View", run: () => setPanelOpen(!panelOpen) },
  ]);
  const cols = panelOpen ? "lg:grid-cols-[300px_minmax(0,1fr)_340px]" : "lg:grid-cols-[300px_minmax(0,1fr)]";
  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className={cn("grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]", cols)}>
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
          <GlowPanel glow="magenta">
            <Section id="arrange.bank" title="Bank" summary={`${A.bank.length} checked`}>
              <BankPanel />
            </Section>
          </GlowPanel>
          <GlowPanel glow="orange">
            <Section id="arrange.generate" title="Generate">
              <GeneratePanel />
            </Section>
          </GlowPanel>
          <GlowPanel glow="magenta">
            <Section id="arrange.program" title="Program and limits" defaultOpen={false}>
              <ProgramPanel />
            </Section>
          </GlowPanel>
          <GlowPanel glow="orange">
            <Section id="arrange.saved" title="Saved arrangements" summary={`${A.ui.saved.length}`} defaultOpen={false}>
              <SavedPanel />
            </Section>
          </GlowPanel>
        </div>

        {/* Pinned to the top on phones while the controls scroll underneath. */}
        <div className="order-1 flex min-w-0 flex-col gap-3 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:self-start max-lg:bg-background/95 max-lg:pb-2 lg:order-none lg:min-h-0">
          <CenterStage onExport={() => setExportOpen(true)} panelOpen={panelOpen} onPanel={() => setPanelOpen(!panelOpen)} />
        </div>

        {panelOpen && (
          <div className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:min-h-0 lg:overflow-y-auto">
            <GlowPanel glow="magenta">
              <div className="space-y-3 p-4">
                <div className="flex gap-1.5">
                  {SIDE_TABS.map(([k, label]) => (
                    <Chip key={k} active={sideTab === k} onClick={() => setSideTab(k)}>
                      {label}
                      {k === "piece" && A.sel.size > 0 && <span className="ml-1 text-pink">{A.sel.size}</span>}
                    </Chip>
                  ))}
                </div>
                {sideTab === "piece" && <SelectionPanel />}
                {sideTab === "info" && <InfoPanel />}
                {sideTab === "tools" && (
                  <div className="space-y-4">
                    <Section id="arrange.tools.help" variant="inline" title="Suggest, fill the gap, replace" defaultOpen>
                      <HelperPanel />
                    </Section>
                    <Section id="arrange.tools.smooth" variant="inline" title="Smooth and seal" defaultOpen={false}>
                      <SmoothPanel />
                    </Section>
                    <Section id="arrange.tools.tests" variant="inline" title="Interlock test and pair matrix" defaultOpen={false}>
                      <TestsPanel />
                    </Section>
                  </div>
                )}
              </div>
            </GlowPanel>
          </div>
        )}
      </div>
      <OrphanDialog />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} onPreviewTour={(plan, seconds) => setTour({ plan, seconds })} />
      {tour && <TourPlayer tour={tour} onStop={() => setTour(null)} />}
    </div>
  );
}

export function ArrangeTab() {
  return (
    <ArrangeProvider>
      <ArrangeLayout />
    </ArrangeProvider>
  );
}

