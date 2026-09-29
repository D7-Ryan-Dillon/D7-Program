"use client";

import type { FaceName, ParsedTile } from "@/lib/types";
import { FACE_NAMES } from "@/lib/types";
import { Separator } from "@/components/ui/separator";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

function pct(n: number | undefined) {
  return n === undefined ? "—" : `${(n * 100).toFixed(1)}%`;
}

function ft2(n: number | undefined) {
  return n === undefined ? "—" : `${n.toFixed(1)} ft²`;
}

export function MetricsPanel({ tile }: { tile: ParsedTile }) {
  const { metrics, config } = tile;
  const openFaces = FACE_NAMES.filter((f) => (metrics.faces?.[f]?.open_area_ft2 ?? 0) > 8);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="truncate text-base font-medium">{tile.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">id {tile.id}</div>
        {tile.guessed.category && (
          <div className="mt-1 font-mono text-[11px] uppercase tracking-label text-orange">
            {tile.guessed.category}
            {tile.guessed.typology ? ` · ${tile.guessed.typology}` : ""}
          </div>
        )}
      </div>

      <Separator />

      <div>
        <Stat label="Tile size" value={`${tile.tileFt.join(" × ")} ft`} />
        <Stat label="Cell size" value={`${tile.cellFt} ft`} />
        <Stat label="Grid" value={tile.grid.join(" × ")} />
        <Stat label="Void fraction" value={pct(metrics.void_fraction)} />
        <Stat label="Void volume" value={`${metrics.void_volume_ft3.toFixed(0)} ft³`} />
        {metrics.void_pieces !== undefined && <Stat label="Void pieces" value={metrics.void_pieces} />}
      </div>

      <Separator />

      <div>
        <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">
          Faces reached ({openFaces.length}/6)
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          {FACE_NAMES.map((f: FaceName) => (
            <Stat key={f} label={f} value={ft2(metrics.faces?.[f]?.open_area_ft2)} />
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <div className="mb-1 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Recipe settings</div>
        <Stat label="Steps" value={config.steps ?? "—"} />
        <Stat label="Gravity" value={config.gravity ?? "—"} />
        <Stat label="Drain" value={config.drain ? "on" : "off"} />
        <Stat label="Seed" value={config.seed ?? "—"} />
        <Stat label="Weld" value={config.weld || "—"} />
        {config.foam && (
          <>
            <Stat label="Foam noise" value={config.foam.noise ?? "—"} />
            <Stat label="Foam web" value={config.foam.web ?? "—"} />
          </>
        )}
      </div>
    </div>
  );
}
