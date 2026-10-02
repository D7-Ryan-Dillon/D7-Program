"use client";

import type { FaceName, ParsedTile } from "@/lib/types";
import { faceNamesOf } from "@/lib/types";
import { Section } from "@/components/shared/Section";

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
  const tileFaceNames = faceNamesOf(tile);
  const openFaces = tileFaceNames.filter((f) => (metrics.faces?.[f]?.open_area_ft2 ?? 0) > 8);

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

      <Section id="viewer.specs" variant="inline" title="Tile" bodyClassName="space-y-0">
        <Stat label="Tile size" value={`${tile.tileFt.join(" × ")} ft`} />
        <Stat label="Cell size" value={`${tile.cellFt} ft`} />
        <Stat label="Grid" value={tile.grid.join(" × ")} />
        <Stat label="Void fraction" value={pct(metrics.void_fraction)} />
        <Stat label="Void volume" value={`${metrics.void_volume_ft3.toFixed(0)} ft³`} />
        {metrics.void_pieces !== undefined && <Stat label="Void pieces" value={metrics.void_pieces} />}
      </Section>

      <Section id="viewer.faces" variant="inline" title={`Faces reached (${openFaces.length}/${tileFaceNames.length})`} bodyClassName="space-y-0">
        <div className="grid grid-cols-2 gap-x-3">
          {tileFaceNames.map((f: FaceName) => (
            <Stat key={f} label={f} value={ft2(metrics.faces?.[f]?.open_area_ft2)} />
          ))}
        </div>
      </Section>

      <Section id="viewer.recipe" variant="inline" title="Recipe settings" defaultOpen={false} bodyClassName="space-y-0">
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
      </Section>
    </div>
  );
}

type Row = { label: string; values: string[] };

/** Specs for several tiles at once: one aligned table, a column per viewport
 * (numbered like the viewport badges). Values that are the same in every
 * column are muted, so what actually differs between the tiles stands out. */
export function MetricsTable({ tiles }: { tiles: ParsedTile[] }) {
  const faceNames = [...new Set(tiles.flatMap((t) => faceNamesOf(t)))];
  const section = (title: string, rows: Row[]) => ({ title, rows });
  const sections = [
    section("Tile", [
      { label: "Size", values: tiles.map((t) => `${t.tileFt.join("×")} ft`) },
      { label: "Cell", values: tiles.map((t) => `${t.cellFt} ft`) },
      { label: "Grid", values: tiles.map((t) => t.grid.join("×")) },
    ]),
    section("Void", [
      { label: "Fraction", values: tiles.map((t) => pct(t.metrics.void_fraction)) },
      { label: "Volume", values: tiles.map((t) => `${t.metrics.void_volume_ft3.toFixed(0)} ft³`) },
      { label: "Pieces", values: tiles.map((t) => String(t.metrics.void_pieces ?? "—")) },
    ]),
    section("Faces open (ft²)", [
      {
        label: "Reached",
        values: tiles.map((t) => {
          const names = faceNamesOf(t);
          return `${names.filter((f) => (t.metrics.faces?.[f]?.open_area_ft2 ?? 0) > 8).length}/${names.length}`;
        }),
      },
      ...faceNames.map((f) => ({
        label: f,
        values: tiles.map((t) => (faceNamesOf(t).includes(f as FaceName) ? (t.metrics.faces?.[f as FaceName]?.open_area_ft2 ?? 0).toFixed(1) : "—")),
      })),
    ]),
    section("Recipe", [
      { label: "Steps", values: tiles.map((t) => String(t.config.steps ?? "—")) },
      { label: "Gravity", values: tiles.map((t) => String(t.config.gravity ?? "—")) },
      { label: "Drain", values: tiles.map((t) => (t.config.drain ? "on" : "off")) },
      { label: "Seed", values: tiles.map((t) => String(t.config.seed ?? "—")) },
      { label: "Weld", values: tiles.map((t) => String(t.config.weld || "—")) },
      { label: "Foam noise", values: tiles.map((t) => String(t.config.foam?.noise ?? "—")) },
      { label: "Foam web", values: tiles.map((t) => String(t.config.foam?.web ?? "—")) },
    ]),
  ];

  return (
    <div className="text-xs">
      <div className="mb-2 grid items-center gap-x-2" style={{ gridTemplateColumns: `4.5rem repeat(${tiles.length}, minmax(0, 1fr))` }}>
        <span />
        {tiles.map((t, i) => (
          <div key={t.id} className="min-w-0" title={t.name}>
            <span className="mb-0.5 flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-magenta to-orange font-mono text-[10px] text-white">{i + 1}</span>
            <div className="truncate text-[10px] leading-tight text-muted-foreground">{t.name}</div>
          </div>
        ))}
      </div>
      {sections.map((s) => (
        <Section key={s.title} id={`viewer.table.${s.title.split(" ")[0].toLowerCase()}`} variant="inline" title={s.title} defaultOpen={s.title !== "Recipe"} bodyClassName="space-y-0">
          {s.rows.map((r) => {
            const same = r.values.every((v) => v === r.values[0]);
            return (
              <div key={r.label} className="grid items-baseline gap-x-2 py-0.5" style={{ gridTemplateColumns: `4.5rem repeat(${tiles.length}, minmax(0, 1fr))` }}>
                <span className="truncate font-mono text-[10px] uppercase tracking-label text-muted-foreground">{r.label}</span>
                {r.values.map((v, i) => (
                  <span key={i} className={`truncate font-mono text-[11px] ${same ? "text-muted-foreground" : "text-foreground"}`}>
                    {v}
                  </span>
                ))}
              </div>
            );
          })}
        </Section>
      ))}
    </div>
  );
}
