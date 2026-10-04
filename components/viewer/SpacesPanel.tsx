"use client";

import { Section } from "@/components/shared/Section";
import { Select } from "@/components/ui/select";
import { useProjectUi } from "@/lib/project-store";
import { printChecks, type CheckStatus } from "@/lib/tiles/checks";
import { cn } from "@/lib/utils";
import type { ParsedTile } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

const DOT: Record<CheckStatus, string> = { ok: "bg-pink", warn: "bg-orange", fail: "bg-destructive" };

/** The print scales the checks and the STL export offer (1 : ratio). */
export const PRINT_SCALES = [
  { ratio: 240, label: "1 in = 20 ft (1:240)" },
  { ratio: 120, label: "1 in = 10 ft (1:120)" },
  { ratio: 96, label: "1 in = 8 ft (1:96)" },
  { ratio: 60, label: "1 in = 5 ft (1:60)" },
];

/** The print scale a project uses for its checks and its STL files (shared by the checks here and the Export panel). */
const defaultPrint = () => ({ ratio: 120 });
export function usePrintRatio(): [number, (r: number) => void] {
  const [ui, setUi] = useProjectUi<{ ratio: number }>("print", defaultPrint);
  return [ui.ratio, (ratio) => setUi((prev) => ({ ...prev, ratio }))];
}

/** What the tile is as architecture: its floors and rooms, light and route, the floor plates, how the foam holds and prints. */
export function SpacesPanel({ tile, onShowLevel }: { tile: ParsedTile; onShowLevel?: (levelId: number) => void }) {
  const spaces = tile.spaces;
  const structure = tile.structure;
  const [ratio, setRatio] = usePrintRatio();
  if (!spaces || !structure) return null;
  const rooms = spaces.rooms;
  const biggest = rooms[0];
  // a room's height as its name gives it (a shaft: full height; otherwise typical clear height), the same rule the Monumental descriptor uses
  const tallest = rooms.reduce((a, r) => Math.max(a, r.kind === "shaft" ? r.clear_height_ft.max : r.clear_height_ft.mean), 0);
  const route = spaces.main_route;
  const checks = printChecks(tile, ratio);
  const worst = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  const plates = tile.plates ?? [];
  const mm = 304.8 / ratio;

  return (
    <>
      <Section id="viewer.spaces" variant="inline" title={`Spaces (${spaces.levels.length} level${spaces.levels.length === 1 ? "" : "s"}, ${rooms.length} room${rooms.length === 1 ? "" : "s"})`} bodyClassName="space-y-0">
        {spaces.levels.length > 0 && (
          <div className="mb-1 space-y-0.5">
            {spaces.levels.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={!onShowLevel}
                onClick={() => onShowLevel?.(l.id)}
                title={onShowLevel ? "Show this level's plan" : undefined}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/5 disabled:hover:bg-transparent"
              >
                <span className="truncate text-xs">{l.name.replace(/^the /, "")}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {Math.round(l.area_ft2)} ft² · {l.clear_height_ft.mean.toFixed(0)} ft clear
                </span>
              </button>
            ))}
          </div>
        )}
        {biggest && <Stat label="Largest room" value={`${biggest.kind}, ${biggest.volume_ft3.toFixed(0)} ft³`} />}
        <Stat label="Tallest clear" value={`${tallest.toFixed(1)} ft`} />
        <Stat label="Floor in light" value={`${(spaces.daylight.lit_floor_fraction * 100).toFixed(0)}% (${(spaces.daylight.sky_floor_fraction * 100).toFixed(0)}% under open sky)`} />
        {route && <Stat label="Main route" value={`${route.from} to ${route.to}: ${route.length_ft.toFixed(0)} ft, ${route.sinuosity.toFixed(2)}×`} />}
        {spaces.profile && <Stat label="Squeeze along it" value={`${spaces.profile.max_ft2.toFixed(0)} to ${spaces.profile.min_ft2.toFixed(0)} ft²`} />}
        {rooms.length > 0 && (
          <details className="pt-1.5">
            <summary className="font-mono text-[11px] uppercase tracking-label text-muted-foreground hover:text-foreground">Rooms</summary>
            <div className="space-y-0.5 pt-1.5">
              {rooms.map((r) => (
                <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">
                  <span className="truncate" title={r.name}>
                    {r.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.volume_ft3.toFixed(0)} ft³</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Section>

      {plates.length > 0 && (
        <Section id="viewer.plates" variant="inline" title={`Floor plates (${plates.length})`} defaultOpen={false} bodyClassName="space-y-1">
          {plates.map((p) => (
            <div key={p.id} className="rounded-md border-hair px-2 py-1.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium" title={p.name}>
                  {p.name}
                </span>
                <span className={cn("shrink-0 font-mono text-[10px] uppercase tracking-label", p.support?.supported === false ? "text-orange" : "text-muted-foreground")}>
                  {p.support?.supported === false ? "not held up" : p.support?.supported ? "held up" : ""}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {p.area_ft2.toFixed(0)} ft² · top {p.top_z_ft ? p.top_z_ft.mean.toFixed(1) : "?"} ft · {p.slope_deg.toFixed(0)}° · {p.thickness_ft.toFixed(1)} ft thick
              </div>
              {p.space_above && (
                <div className="font-mono text-[11px] text-muted-foreground">
                  {p.space_above.clear_height_ft.mean.toFixed(1)} ft clear above, {p.space_below ? p.space_below.clear_height_ft.mean.toFixed(1) : "0.0"} below
                  {p.openings && p.openings.count > 0 ? ` · ${p.openings.count} opening${p.openings.count === 1 ? "" : "s"}` : ""}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section id="viewer.structure" variant="inline" title="Structure" defaultOpen={false} bodyClassName="space-y-0">
        <Stat label="Foam pieces" value={structure.foam_pieces} />
        {structure.floating_ft3 > 0 && <Stat label="Outside main body" value={`${structure.floating_ft3.toFixed(1)} ft³`} />}
        <Stat label="Held by plates" value={`${(structure.plate_share * 100).toFixed(0)}% of the foam`} />
        <Stat label="Overhang" value={`${structure.overhang_area_ft2.toFixed(0)} ft²`} />
        <Stat label="On the bed" value={`${structure.bed_contact_ft2.toFixed(0)} ft²`} />
      </Section>

      <Section
        id="viewer.print"
        variant="inline"
        title="Print checks"
        defaultOpen
        summary={`${(tile.tileFt[0] * mm).toFixed(0)} mm block`}
        action={<span className={cn("h-2 w-2 rounded-full", DOT[worst])} aria-label={worst} />}
        bodyClassName="space-y-2"
      >
        <Select className="h-7 text-[11px]" value={String(ratio)} onChange={(e) => setRatio(Number(e.target.value))} aria-label="Print scale">
          {PRINT_SCALES.map((s) => (
            <option key={s.ratio} value={s.ratio}>
              {s.label}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Printed {(tile.tileFt[0] * mm).toFixed(0)} x {(tile.tileFt[1] * mm).toFixed(0)} x {(tile.tileFt[2] * mm).toFixed(0)} mm, 0.4 mm nozzle.
        </p>
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div key={c.key} className="flex gap-2 text-xs">
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[c.status])} />
              <div className="min-w-0">
                <div className="font-medium">{c.label}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
