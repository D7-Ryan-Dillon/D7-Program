"use client";

import { useRef, useState } from "react";
import { Camera, Eye, Ghost, RotateCcw, RotateCw, Scissors } from "lucide-react";
import { ThreeViewport, type DisplayMode, type MeshColors, type MeshOpacity, type MeshVisibility } from "@/components/viewer/ThreeViewport";
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
const SWATCHES = ["#e8a6c8", "#c43383", "#db7228", "#f2b878", "#9aa0a6", "#e6e6e6", "#1c1c1f"];

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
}

export const defaultPane = (autoRotate = false): PaneState => ({
  tileId: null,
  view: "perspective",
  autoRotate,
  rotateSecs: 24,
  displayMode: "rendered",
  visibility: { foam: true, void: true },
  colors: { foam: "#e8a6c8", void: "#1c1c1f" },
  opacity: { foam: 1, void: 1 },
  clip: defaultClipState(),
});

/** Fills in anything an older saved pane doesn't have yet. */
export const normalizePane = (p: Partial<PaneState> | undefined, autoRotate = false): PaneState => mergeDefaults(defaultPane(autoRotate), p);

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
  if (fields.includes("view")) next.view = source.view;
  if (fields.includes("display")) next.displayMode = source.displayMode;
  if (fields.includes("visibility")) Object.assign(next, { visibility: { ...source.visibility }, colors: { ...source.colors }, opacity: { ...source.opacity } });
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
}) {
  const handleRef = useRef<ViewportHandle | null>(null);
  const [nonce, setNonce] = useState(0);
  const ghosted = pane.displayMode === "ghosted";
  const all = (patch: Partial<PaneState>) => (onApplyAll ? () => onApplyAll(patch) : undefined);

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
        <ThreeViewport
          key={tile.id}
          tile={tile}
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
      </div>

      <div className="flex flex-wrap items-center gap-1">
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

        <PaneMenu icon={Eye} label="Visibility" showLabel={!compact} active={!pane.visibility.foam || !pane.visibility.void} onApplyAll={all({ visibility: pane.visibility, colors: pane.colors, opacity: pane.opacity })}>
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
      </div>
    </div>
  );
}
