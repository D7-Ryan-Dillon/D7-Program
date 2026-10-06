"use client";

import { cn } from "@/lib/utils";
import type { BarSpec } from "@/lib/scoring/bars";

/**
 * The at-a-glance bar of one descriptor: segments for the app's scale words, filled up to where the measurement falls (hatched and lighter when the
 * value is only a proxy or an assumption, empty when it cannot be assessed), and a thin fit line for how close it is to what the tile's typology prefers.
 */
export function MatrixBar({ bar, compact = false, className }: { bar: BarSpec; compact?: boolean; className?: string }) {
  const empty = bar.index === null;
  return (
    <div className={cn("w-full", className)} title={empty ? "Not assessable for this tile" : `${bar.word ?? ""} (${bar.status})${bar.fit !== null ? ` · fit to typology ${Math.round(bar.fit * 100)}%` : ""}`}>
      <div className="flex gap-0.5" role="img" aria-label={`${bar.label}: ${empty ? "not assessable" : bar.word ?? `band ${bar.index! + 1} of ${bar.steps}`}`}>
        {Array.from({ length: bar.steps }, (_, i) => {
          const on = bar.index !== null && i <= bar.index;
          return (
            <div
              key={i}
              className={cn(
                compact ? "h-1.5" : "h-2",
                "flex-1 rounded-sm",
                on ? (bar.solid ? "bg-gradient-to-r from-magenta to-orange" : "bg-gradient-to-r from-magenta to-orange opacity-50 ring-1 ring-inset ring-white/40") : empty ? "border border-dashed border-white/20" : "bg-white/10",
              )}
            />
          );
        })}
      </div>
      {!compact && (
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="text-foreground">{empty ? "not assessable" : bar.word ?? `band ${bar.index! + 1}/${bar.steps}`}</span>
          {bar.fit !== null && (
            <span className="flex flex-1 items-center gap-1.5" title="How close the measurement is to what this typology prefers (the rule is in Variants and Criteria)">
              <span>fit</span>
              <span className="relative h-0.5 flex-1 rounded bg-white/10">
                <span className="absolute inset-y-0 left-0 rounded bg-pink" style={{ width: `${Math.round(bar.fit * 100)}%` }} />
              </span>
              <span>{Math.round(bar.fit * 100)}%</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
