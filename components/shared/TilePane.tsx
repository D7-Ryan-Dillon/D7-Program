"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Eye, Ghost, Layers, PenLine, RotateCcw, RotateCw, Ruler, Scissors } from "lucide-react";
import { PLATE_COLOR, STRUT_COLOR, ThreeViewport, type DisplayMode, type MeshColors, type MeshOpacity, type MeshVisibility } from "@/components/viewer/ThreeViewport";
import { DrawingExport, DrawingView } from "@/components/viewer/DrawingView";
import { defaultDrawState, type DrawMode, type DrawState } from "@/lib/drawing/state";
import type { TintMode } from "@/lib/tiles/tint";
import type { Evidence } from "@/lib/scoring/descriptors";
import { ViewportExportButton } from "@/components/shared/ViewportExport";
import { PaneMenu } from "@/components/shared/PaneMenu";
import { Segmented } from "@/components/shared/Segmented";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { ClippingPlaneControl } from "@/components/shared/ClippingPlaneControl";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ALL_VIEWS, AXO_VIEWS } from "@/lib/faceViews";
import { defaultClipState, type ClipState } from "@/lib/clipping";
import { mergeDefaults } from "@/lib/mergeDefaults";
import { cn } from "@/lib/utils";
import type { CameraLink } from "@/lib/cameraLink";
import type { ViewportHandle } from "@/lib/viewportCapture";
import type { ParsedTile } from "@/lib/types";

/** Every view a pane can show: the face views, then the axo corners. */
const PANE_VIEWS = [...ALL_VIEWS, ...AXO_VIEWS.filter((v) => !ALL_VIEWS.some((a) => a.key === v.key))];
const SWATCHES = ["#ffffff", "#e8a6c8", "#c43383", "#db7228", "#f2b878", "#9a9a9a", "#e6e6e6", "#1c1c1c"];

/** Everything one viewport remembers (saved with the project). */
export interface PaneState {
  /** null = follow the default tile for this pane. */
  tileId: string | null;
  view: string;
  autoRotate: boolean;
  /** Seconds per full turn while auto-rotating. */
  rotateSecs: number;
  displayMode: DisplayMode;
  visibility: MeshVisibility;
  colors: MeshColors;
  opacity: MeshOpacity;
  clip: ClipState;
  /** Colour the void by room or level (needs the tile's room data). */
  tint: TintMode;
  /** 3D model, or the automatic plan / section drawing of the tile. */
  draw: DrawState;
  /** Which default look this pane was saved with (see LOOK_VERSION). */
  look?: number;
}

/** The default look is solid white foam alone (void, plates and branches off). Panes saved with an older look are brought to it once. */
export const LOOK_VERSION = 2;

export const defaultPane = (autoRotate = false): PaneState => ({
  tileId: null,
  view: "perspective",
  autoRotate,
  rotateSecs: 24,
  displayMode: "rendered",
  // solid white foam alone; void (magenta), plates (peach) and branches (orange) are one switch away under Layers
  visibility: { foam: true, void: false, plates: false, struts: false },
  colors: { foam: "#ffffff", void: "#c43383", plates: PLATE_COLOR, struts: STRUT_COLOR },
  opacity: { foam: 1, void: 1, plates: 1, struts: 1 },
  clip: defaultClipState(),
  tint: "none",
  draw: defaultDrawState(),
  look: LOOK_VERSION,
});

/** Fills in anything an older saved pane doesn't have yet; a pane saved with an older default look takes the current one (view, tile, clip and drawing are kept). */
export const normalizePane = (p: Partial<PaneState> | undefined, autoRotate = false): PaneState => {
  if (p && (p.look ?? 0) < LOOK_VERSION) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { visibility, colors, opacity, autoRotate: _rotate, displayMode, tint, ...keep } = p;
    return mergeDefaults(defaultPane(autoRotate), keep);
  }
  return mergeDefaults(defaultPane(autoRotate), p);
};

/** Which groups of settings "Sync all" copies. */
export type SyncField = "view" | "display" | "visibility" | "clip" | "rotation";
export const SYNC_FIELDS: { key: SyncField; label: string }[] = [
  { key: "view", label: "View (camera angle)" },
  { key: "display", label: "Rendered / ghosted" },
  { key: "visibility", label: "Visibility, colours, opacity" },
  { key: "clip", label: "Clipping plane" },
  { key: "rotation", label: "Auto-rotate + speed" },
];

/** The settings in `fields` copied from `source` onto `target`. */
export function syncPane(target: PaneState, source: PaneState, fields: SyncField[]): PaneState {
  const next = { ...target };
  if (fields.includes("view")) {
    next.view = source.view;
    next.draw = { ...source.draw };
  }
  if (fields.includes("display")) next.displayMode = source.displayMode;
  if (fields.includes("visibility")) Object.assign(next, { visibility: { ...source.visibility }, colors: { ...source.colors }, opacity: { ...source.opacity }, tint: source.tint });
  if (fields.includes("clip")) next.clip = JSON.parse(JSON.stringify(source.clip));
  if (fields.includes("rotation")) Object.assign(next, { autoRotate: source.autoRotate, rotateSecs: source.rotateSecs });
  return next;
}

/** OrbitControls' autoRotateSpeed for a given seconds-per-turn (2 = 30 s at 60 fps). */
export const speedFor = (secs: number) => 60 / Math.max(secs, 1);

function MeshRow({
  label,
  visible,
  onVisible,
  color,
  onColor,
  opacity,
  onOpacity,
  opacityActive,
}: {
  label: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  color: string;
  onColor: (c: string) => void;
  opacity: number;
  onOpacity: (o: number) => void;
  opacityActive: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">{label}</span>
        <Switch checked={visible} onCheckedChange={onVisible} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} colour ${c}`}
            onClick={() => onColor(c)}
            className={cn("h-4 w-4 rounded-full border transition-transform hover:scale-110", color === c ? "border-white/80 ring-1 ring-white/40" : "border-white/20")}
            style={{ backgroundColor: c }}
          />
        ))}
        <input type="color" value={color} onChange={(e) => onColor(e.target.value)} aria-label={`${label} custom colour`} className="h-4 w-6" />
      </div>
      <div className={cn(!opacityActive && "opacity-40")}>
        <NumberSlider label={opacityActive ? "Opacity" : "Opacity (rendered mode)"} value={Math.round(opacity * 100)} min={10} max={100} suffix="%" onChange={(v) => onOpacity(v / 100)} />
      </div>
    </div>
  );
}

/** One tile viewport. The viewport itself is left completely clear: a header
 * above it names the file (number badge + tile picker) and a slim strip of
 * small icon buttons below it opens one setting each (view, display,
 * visibility + opacity, clipping, rotation) plus Export. */
export function TilePane({
  index = 1,
  tile,
  pane,
  onPane,
  tileChoices,
  onPickTile,
  link,
  compact = false,
  onApplyAll,
  emphasis,
}: {
  /** 1-based number shown on the viewport's badge (and in the specs table). */
  index?: number;
  tile: ParsedTile;
  pane: PaneState;
  onPane: (patch: Partial<PaneState>) => void;
  /** When given, the header has a picker for which tile this pane shows. */
  tileChoices?: ParsedTile[];
  onPickTile?: (id: string) => void;
  link?: CameraLink;
  compact?: boolean;
  /** When given, each setting's popup offers "Apply to all viewports". */
  onApplyAll?: (patch: Partial<PaneState>) => void;
  /** Rooms / levels / the route to light up (the Analysis's evidence): tinted in 3D, lit on a plan or section. */
  emphasis?: Evidence;
}) {
  const handleRef = useRef<ViewportHandle | null>(null);
  const [nonce, setNonce] = useState(0);
  const ghosted = pane.displayMode === "ghosted";
  const all = (patch: Partial<PaneState>) => (onApplyAll ? () => onApplyAll(patch) : undefined);
  const tintEmphasis = useMemo(() => (emphasis ? { rooms: emphasis.rooms, levels: emphasis.levels } : undefined), [emphasis]);
  const draw = pane.draw;
  const drawing = draw.mode !== "model";
  const levels = tile.spaces?.levels ?? [];
  const hasParts = !!tile.partsUrl;
  const hasRooms = !!tile.voxels.rooms;
  const setDraw = (patch: Partial<DrawState>) => onPane({ draw: { ...draw, ...patch } });
  const span = tile.tileFt[draw.axis === "x" ? 0 : 1];
  const defaults = defaultPane();
  const looks: { label: string; hint: string; patch: Partial<PaneState> }[] = [
    {
      label: "Architecture",
      hint: "foam faint, floor plates and branches solid",
      patch: { displayMode: "rendered", tint: "none", visibility: { ...pane.visibility, foam: true, void: false, plates: true, struts: true }, opacity: { ...pane.opacity, foam: 0.3, plates: 1, struts: 1 } },
    },
    {
      label: "Rooms",
      hint: "the void tinted room by room",
      patch: { displayMode: "rendered", tint: "rooms", visibility: { ...pane.visibility, foam: true, void: true }, opacity: { ...pane.opacity, foam: 0.12, void: 1 } },
    },
    { label: "Reset", hint: "everything back to solid white foam", patch: { displayMode: "rendered", tint: "none", visibility: defaults.visibility, opacity: defaults.opacity, colors: defaults.colors } },
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-magenta to-orange font-mono text-[11px] text-white">{index}</span>
        {tileChoices && onPickTile ? (
          <Select className="h-6 min-w-0 flex-1 text-[11px]" value={tile.id} onChange={(e) => onPickTile(e.target.value)} aria-label={`Tile shown in viewport ${index}`}>
            {tileChoices.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={tile.name}>
            {tile.name}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {drawing ? (
          <DrawingView tile={tile} draw={draw} highlight={emphasis} />
        ) : (
        <ThreeViewport
          key={tile.id}
          tile={tile}
          tint={pane.tint}
          emphasis={tintEmphasis}
          displayMode={pane.displayMode}
          visibility={pane.visibility}
          colors={pane.colors}
          opacity={pane.opacity}
          clip={pane.clip}
          activeViewKey={pane.view}
          autoRotate={pane.autoRotate}
          autoRotateSpeed={speedFor(pane.rotateSecs)}
          viewNonce={nonce}
          handleRef={handleRef}
          link={link}
        />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <PaneMenu icon={Layers} label={draw.mode === "model" ? "3D" : draw.mode === "plan" ? "Plan" : "Section"} showLabel={!compact} active={drawing} onApplyAll={all({ draw: pane.draw })}>
          <Segmented
            value={draw.mode}
            options={[{ value: "model", label: "3D" }, { value: "plan", label: "Plan" }, { value: "section", label: "Section" }]}
            onChange={(mode) => setDraw({ mode: mode as DrawMode })}
          />
          <p className="text-[10px] text-muted-foreground">Plan and Section are drawn automatically from the tile: foam and plates cut solid, void open, 10 ft ruler.</p>
        </PaneMenu>

        {drawing && draw.mode === "plan" && (
          <PaneMenu icon={Layers} label="Level" showLabel={!compact} onApplyAll={all({ draw: pane.draw })}>
            {levels.length ? (
              <div className="flex flex-wrap gap-1">
                {levels.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setDraw({ level: l.id })}
                    className={cn("rounded-full border-hair px-2 py-0.5 font-mono text-[10px] tracking-label transition-colors", (draw.level ?? levels[0].id) === l.id ? "border-magenta/60 bg-magenta/15 text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {l.name.replace(/^the /, "")} · {Math.round(l.area_ft2)} ft²
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">This tile has no floors to cut a plan through; showing a plan at mid height.</p>
            )}
            <p className="text-[10px] text-muted-foreground">Each plan is cut 4 ft above the level&apos;s floor, the floor tinted below.</p>
          </PaneMenu>
        )}
        {drawing && draw.mode === "section" && (
          <PaneMenu icon={Ruler} label="Section" showLabel={!compact} onApplyAll={all({ draw: pane.draw })}>
            <Segmented value={draw.axis} options={[{ value: "x", label: "Along X" }, { value: "y", label: "Along Y" }]} onChange={(axis) => setDraw({ axis: axis as "x" | "y", pos: null })} />
            <NumberSlider label="Position" value={draw.pos ?? span / 2} min={tile.cellFt / 2} max={span - tile.cellFt / 2} step={tile.cellFt} suffix=" ft" decimals={1} onChange={(pos) => setDraw({ pos })} />
          </PaneMenu>
        )}
        {drawing && (
          <PaneMenu icon={PenLine} label="Drawing" showLabel={!compact} onApplyAll={all({ draw: pane.draw })}>
            <Segmented value={draw.ground} options={[{ value: "dark", label: "Dark" }, { value: "paper", label: "Paper" }]} onChange={(ground) => setDraw({ ground })} />
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">Room labels</span>
              <Switch checked={draw.labels} onCheckedChange={(labels) => setDraw({ labels })} />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">Main route</span>
              <Switch checked={draw.route} onCheckedChange={(route) => setDraw({ route })} />
            </label>
            <div className="border-t border-border pt-2">
              <DrawingExport tile={tile} draw={draw} />
            </div>
          </PaneMenu>
        )}

        {!drawing && (<>
        <PaneMenu icon={Camera} label="View" showLabel={!compact} onApplyAll={all({ view: pane.view })}>
          <div className="flex flex-wrap gap-1">
            {PANE_VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => onPane({ view: v.key })}
                className={cn("rounded-full border-hair px-2 py-0.5 font-mono text-[10px] uppercase tracking-label transition-colors", pane.view === v.key ? "border-magenta/60 bg-magenta/15 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setNonce((n) => n + 1)}>
            <RotateCcw className="h-3 w-3" /> Snap back to this view
          </button>
        </PaneMenu>

        <PaneMenu icon={Ghost} label="Display" showLabel={!compact} active={ghosted} onApplyAll={all({ displayMode: pane.displayMode })}>
          <Segmented value={pane.displayMode} options={[{ value: "rendered", label: "Rendered" }, { value: "ghosted", label: "Ghosted" }]} onChange={(displayMode) => onPane({ displayMode })} />
        </PaneMenu>

        <PaneMenu icon={Eye} label="Layers" showLabel={!compact} active={pane.visibility.foam !== defaults.visibility.foam || pane.visibility.void !== defaults.visibility.void || !!pane.visibility.plates !== !!defaults.visibility.plates || !!pane.visibility.struts !== !!defaults.visibility.struts || pane.opacity.foam !== defaults.opacity.foam || pane.tint !== "none"} onApplyAll={all({ visibility: pane.visibility, colors: pane.colors, opacity: pane.opacity, tint: pane.tint })}>
          {(hasParts || hasRooms) && (
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Quick looks</div>
              <div className="flex flex-wrap gap-1">
                {looks.map((l) => (
                  <button key={l.label} type="button" title={l.hint} onClick={() => onPane(l.patch)} className="rounded-full border-hair px-2 py-0.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground transition-colors hover:border-magenta/50 hover:text-foreground">
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <MeshRow
            label="Foam"
            visible={pane.visibility.foam}
            onVisible={(foam) => onPane({ visibility: { ...pane.visibility, foam } })}
            color={pane.colors.foam}
            onColor={(foam) => onPane({ colors: { ...pane.colors, foam } })}
            opacity={pane.opacity.foam}
            onOpacity={(foam) => onPane({ opacity: { ...pane.opacity, foam } })}
            opacityActive={!ghosted}
          />
          <MeshRow
            label="Void"
            visible={pane.visibility.void}
            onVisible={(v) => onPane({ visibility: { ...pane.visibility, void: v } })}
            color={pane.colors.void}
            onColor={(v) => onPane({ colors: { ...pane.colors, void: v } })}
            opacity={pane.opacity.void}
            onOpacity={(v) => onPane({ opacity: { ...pane.opacity, void: v } })}
            opacityActive={!ghosted}
          />
          {hasParts && (
            <>
              <MeshRow
                label="Floor plates"
                visible={pane.visibility.plates ?? true}
                onVisible={(plates) => onPane({ visibility: { ...pane.visibility, plates } })}
                color={pane.colors.plates ?? PLATE_COLOR}
                onColor={(plates) => onPane({ colors: { ...pane.colors, plates } })}
                opacity={pane.opacity.plates ?? 1}
                onOpacity={(plates) => onPane({ opacity: { ...pane.opacity, plates } })}
                opacityActive={!ghosted}
              />
              {tile.voxels.struts && (
                <MeshRow
                  label="Branches"
                  visible={pane.visibility.struts ?? true}
                  onVisible={(struts) => onPane({ visibility: { ...pane.visibility, struts } })}
                  color={pane.colors.struts ?? STRUT_COLOR}
                  onColor={(struts) => onPane({ colors: { ...pane.colors, struts } })}
                  opacity={pane.opacity.struts ?? 1}
                  onOpacity={(struts) => onPane({ opacity: { ...pane.opacity, struts } })}
                  opacityActive={!ghosted}
                />
              )}
            </>
          )}
          {hasRooms && (
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Tint the void by</div>
              <Segmented value={pane.tint} options={[{ value: "none", label: "None" }, { value: "rooms", label: "Room" }, { value: "levels", label: "Level" }]} onChange={(tint) => onPane({ tint: tint as TintMode })} />
            </div>
          )}
        </PaneMenu>

        <PaneMenu icon={Scissors} label="Clip" showLabel={!compact} active={pane.clip.enabled} onApplyAll={all({ clip: pane.clip })}>
          <ClippingPlaneControl value={pane.clip} onChange={(clip) => onPane({ clip })} />
        </PaneMenu>

        <PaneMenu icon={RotateCw} label="Rotate" showLabel={!compact} active={pane.autoRotate} onApplyAll={all({ autoRotate: pane.autoRotate, rotateSecs: pane.rotateSecs })}>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Auto-rotate</span>
            <Switch checked={pane.autoRotate} onCheckedChange={(autoRotate) => onPane({ autoRotate })} />
          </div>
          <NumberSlider label="Seconds per turn" value={pane.rotateSecs} min={4} max={60} suffix=" s" onChange={(rotateSecs) => onPane({ rotateSecs })} />
          <p className="text-[10px] text-muted-foreground">Drag the model any time to take over; it keeps turning from where you leave it.</p>
        </PaneMenu>

        <ViewportExportButton handleRef={handleRef} name={tile.name} className="h-7 gap-1 px-1.5 text-[10px]" />
        </>)}
      </div>
    </div>
  );
}
