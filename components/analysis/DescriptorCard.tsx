"use client";

import { Crosshair } from "lucide-react";
import { topDrivers, type DescriptorResult } from "@/lib/scoring/descriptors";
import { cn } from "@/lib/utils";

/** One descriptor, read for one tile: the score; what it IS in this tile as spaces (one or two sentences); the qualitative
 * reading on its scale; the quantitative measures behind it; what lifts it and holds it back; and an Evidence button that
 * lights what the sentence is about in the views.
 * `mark` flags, in a compare, the tile that scores highest / lowest on a descriptor the tiles differ on a lot; `spread` is that difference. */
export function DescriptorCard({
  result,
  carried = false,
  mark = null,
  spread = 0,
  evidenceOn = false,
  onEvidence,
}: {
  result: DescriptorResult;
  carried?: boolean;
  mark?: "high" | "low" | null;
  spread?: number;
  /** this card's evidence is what the views are showing */
  evidenceOn?: boolean;
  onEvidence?: () => void;
}) {
  const { lifts, holds } = topDrivers(result.drivers, result.score);
  const ev = result.evidence;
  const hasEvidence = !!(ev.rooms?.length || ev.levels?.length || ev.route);
  const q = result.qualitative;
  return (
    <div className={cn("glass-panel rounded-lg p-4", mark === "high" && "ring-1 ring-pink/60", mark === "low" && "ring-1 ring-orange/70", evidenceOn && "ring-1 ring-orange/80")}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{result.label}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {mark && (
            <span
              className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-label", mark === "high" ? "bg-pink/15 text-pink" : "bg-orange/15 text-orange")}
              title={`The tiles differ by ${Math.round(spread)} points on this`}
            >
              {mark === "high" ? "highest" : "lowest"} · Δ{Math.round(spread)}
            </span>
          )}
          {carried && <span className="rounded-full border border-magenta/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-magenta">carried</span>}
          {result.approximate && <span className="rounded-full border-hair px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-muted-foreground">approx.</span>}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-gradient-to-r from-magenta to-orange transition-[width]" style={{ width: `${Math.round(result.score)}%` }} />
        </div>
        <span className="font-mono text-xs tabular-nums text-foreground">{Math.round(result.score)}</span>
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">In this tile</div>
          <p className="mt-0.5 leading-relaxed text-foreground">{result.explanation}</p>
        </div>

        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">Qualitative</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {q.scale.map((s, i) => (
              <span key={s} className={cn("rounded-full px-2 py-0.5 text-[10px]", i === q.index ? "bg-gradient-to-r from-magenta to-orange font-medium text-white" : "border-hair text-muted-foreground")}>
                {s}
              </span>
            ))}
          </div>
          <div className="mt-1 text-muted-foreground">{q.how}</div>
        </div>

        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">Quantitative</div>
          <div className="mt-0.5 font-mono text-foreground">{result.quant.headline}</div>
          <div className="text-muted-foreground">{result.quant.headlineHow}</div>
          {result.quant.supporting.length > 0 && (
            <dl className="mt-1.5 space-y-0.5">
              {result.quant.supporting.map((s) => (
                <div key={s.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2" title={s.how}>
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="font-mono text-foreground">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {(lifts || holds) && (
          <div className="space-y-0.5">
            {lifts && (
              <div className="flex gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pink" />
                <span>
                  <span className="text-muted-foreground">Lifts it: </span>
                  {lifts.label} <span className="font-mono text-muted-foreground">({lifts.value})</span>
                </span>
              </div>
            )}
            {holds && (
              <div className="flex gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
                <span>
                  <span className="text-muted-foreground">Holds it back: </span>
                  {holds.label} <span className="font-mono text-muted-foreground">({holds.value})</span>
                </span>
              </div>
            )}
          </div>
        )}

        {onEvidence && hasEvidence && (
          <button
            type="button"
            onClick={onEvidence}
            aria-pressed={evidenceOn}
            className={cn(
              "flex items-center gap-1.5 rounded-md border-hair px-2 py-1 font-mono text-[10px] uppercase tracking-label transition-colors",
              evidenceOn ? "border-orange/60 bg-orange/10 text-foreground" : "text-muted-foreground hover:border-white/30 hover:text-foreground",
            )}
            title="Light up, in the views, what this sentence is about"
          >
            <Crosshair className="h-3 w-3" />
            {evidenceOn ? "Showing evidence" : "Evidence"}
          </button>
        )}
      </div>
    </div>
  );
}
