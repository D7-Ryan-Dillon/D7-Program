"use client";

import { cn } from "@/lib/utils";
import { barOf, spreadMarks } from "@/lib/scoring/bars";
import type { MatrixResult } from "@/lib/scoring/matrixEval";
import { MatrixBar } from "@/components/analysis/MatrixBar";

export interface OverviewTile {
  name: string;
  typology?: string;
  results: MatrixResult[];
}

/**
 * Every descriptor of the matrix at one glance: one bar per descriptor (several columns when tiles are compared). A bar is how strongly the tile shows
 * the quality on the app's own scale; hatched means only a proxy or an assumption; click a row to jump to its card with the numbers.
 */
export function OverviewStrip({ tiles, carried = [] }: { tiles: OverviewTile[]; carried?: string[] }) {
  const rows = (tiles[0]?.results ?? []).map((_, d) => d);
  if (!rows.length) return null;
  const cols = tiles.length;
  return (
    <div className="glass-panel rounded-lg p-3" aria-label="All descriptors at a glance">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">At a glance</div>
        <div className="text-[10px] text-muted-foreground">fuller bar = stronger in this tile · hatched = proxy or assumed · dashed = not assessable</div>
      </div>
      <div className={cn("grid items-center gap-x-4 gap-y-1.5", cols > 1 ? "grid-cols-[minmax(7rem,10rem)_repeat(var(--cols),minmax(0,1fr))]" : "grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] md:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_minmax(0,1fr)]")} style={{ ["--cols" as string]: cols }}>
        {cols > 1 && (
          <>
            <span />
            {tiles.map((t, i) => (
              <span key={i} className="truncate font-mono text-[10px] text-foreground" title={t.name}>
                {t.name}
              </span>
            ))}
          </>
        )}
        {rows.map((d) => {
          const bars = tiles.map((t) => (t.results[d] ? barOf(t.results[d], t.typology) : null));
          const marks = cols > 1 ? spreadMarks(bars.map((b) => b as NonNullable<typeof b>).filter(Boolean)) : [];
          const key = tiles[0].results[d].key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => document.getElementById(`matrix-card-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="contents text-left"
              title="Jump to the numbers for this descriptor"
            >
              <span className={cn("truncate text-xs", carried.includes(key) ? "text-foreground" : "text-muted-foreground")}>
                {tiles[0].results[d].criterion.name}
                {carried.includes(key) && <span className="ml-1 text-magenta">●</span>}
              </span>
              {bars.map((b, i) =>
                b ? (
                  <span key={i} className={cn("rounded-sm px-0.5", marks[i] === "high" && "ring-1 ring-pink/60", marks[i] === "low" && "ring-1 ring-orange/70")}>
                    <MatrixBar bar={b} compact />
                    <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">{b.index === null ? "not assessable" : (b.word ?? `${b.index + 1}/${b.steps}`)}</span>
                  </span>
                ) : (
                  <span key={i} />
                ),
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
