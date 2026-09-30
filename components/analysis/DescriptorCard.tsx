"use client";

import type { DescriptorResult } from "@/lib/scoring/descriptors";
import { cn } from "@/lib/utils";

export function DescriptorCard({ result }: { result: DescriptorResult }) {
  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{result.label}</h3>
        {result.approximate && (
          <span className="rounded-full border-hair px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-muted-foreground">
            approx.
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-magenta to-orange transition-[width]"
            style={{ width: `${Math.round(result.score)}%` }}
          />
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
