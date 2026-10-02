"use client";

import type { DescriptorResult } from "@/lib/scoring/descriptors";
import { cn } from "@/lib/utils";

/** `mark` flags, in a compare, the tile that scores highest / lowest on a
 * descriptor the tiles differ on a lot; `spread` is that difference. */
export function DescriptorCard({ result, carried = false, mark = null, spread = 0 }: { result: DescriptorResult; carried?: boolean; mark?: "high" | "low" | null; spread?: number }) {
  return (
    <div className={cn("glass-panel rounded-lg p-4", mark === "high" && "ring-1 ring-emerald-400/60", mark === "low" && "ring-1 ring-orange/70")}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{result.label}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {mark && (
            <span
              className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-label", mark === "high" ? "bg-emerald-400/15 text-emerald-300" : "bg-orange/15 text-orange")}
              title={`The tiles differ by ${Math.round(spread)} points on this`}
            >
              {mark === "high" ? "highest" : "lowest"} · Δ{Math.round(spread)}
            </span>
          )}
          {carried && <span className="rounded-full border border-magenta/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-magenta">carried</span>}
          {result.approximate && (
            <span className="rounded-full border-hair px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-muted-foreground">approx.</span>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-gradient-to-r from-magenta to-orange transition-[width]" style={{ width: `${Math.round(result.score)}%` }} />
        </div>
        <span className="font-mono text-xs tabular-nums text-foreground">{Math.round(result.score)}</span>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">Qualitative</div>
          <div className={cn("mt-0.5 text-foreground")}>{result.verdict}</div>
          <div className="mt-0.5 text-muted-foreground">{result.verdictCriterion}</div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">Quantitative</div>
          <div className="mt-0.5 font-mono text-foreground">{result.quantValue}</div>
          <div className="mt-0.5 text-muted-foreground">{result.quantCriterion}</div>
        </div>
      </div>
    </div>
  );
}
