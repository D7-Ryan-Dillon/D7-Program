"use client";

import { Crosshair, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatrixResult } from "@/lib/scoring/matrixEval";
import { STATUS_HELP, STATUS_LABEL } from "@/lib/scoring/matrix";
import { barOf } from "@/lib/scoring/bars";
import { MatrixBar } from "@/components/analysis/MatrixBar";

const STATUS_TONE: Record<string, string> = {
  measured: "border-pink/50 text-pink",
  inferred: "border-orange/50 text-orange",
  proxy: "border-orange/50 text-orange",
  assumed: "border-orange/50 text-orange",
  unavailable: "border-white/20 text-muted-foreground",
  "not-applicable": "border-white/20 text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-label", STATUS_TONE[status])} title={STATUS_HELP[status as keyof typeof STATUS_HELP]}>
      {STATUS_LABEL[status as keyof typeof STATUS_LABEL]}
    </span>
  );
}

/**
 * One descriptor of the matrix, read for one tile: the matrix's own words for it, the measurement with its units, how it was measured and what it cannot
 * establish, the automated reading (labelled as generated, and replaceable by your own words), and the evidence in the views. The app's older 0-100 index
 * is shown small and labelled as what it is.
 */
export function MatrixCard({
  result,
  carried = false,
  evidenceOn = false,
  onEvidence,
  interpretation,
  onInterpretation,
  mark = null,
  extra,
  typology,
}: {
  result: MatrixResult;
  carried?: boolean;
  evidenceOn?: boolean;
  onEvidence?: () => void;
  /** the text to show as the reading (yours when you wrote one) */
  interpretation: { text: string; edited: boolean };
  onInterpretation?: (text: string) => void;
  mark?: "high" | "low" | null;
  /** anything else that belongs under this descriptor (its settings) */
  extra?: React.ReactNode;
  /** the tile's typology key, for the fit line of the bar */
  typology?: string;
}) {
  const { criterion: c, measure: m, evidence: ev } = result;
  const hasEvidence = !!(ev.rooms?.length || ev.levels?.length || ev.route || ev.routePoints?.length || ev.regions?.length);
  const scale = result.interpretation.scale;
  const idx = result.interpretation.index;
  return (
    <div id={`matrix-card-${c.key}`} className={cn("glass-panel rounded-lg p-4 scroll-mt-24", mark === "high" && "ring-1 ring-pink/60", mark === "low" && "ring-1 ring-orange/70", evidenceOn && "ring-1 ring-orange/80")}>
      <div className="mb-1 font-mono text-[9px] uppercase tracking-label text-muted-foreground">{c.group}</div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{c.name}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          <StatusBadge status={m.status} />
          {carried && <span className="rounded-full border border-magenta/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-magenta">carried</span>}
        </div>
      </div>

      <MatrixBar bar={barOf(result, typology)} className="mb-3" />

      <div className="space-y-3 text-xs">
        <div>
          <div className="font-mono uppercase tracking-label text-muted-foreground">Measured</div>
          <div className="mt-0.5 font-mono text-foreground">{m.headline}</div>
          {m.value !== null && <div className="text-[11px] text-muted-foreground">{m.unit}</div>}
          {m.supporting.length > 0 && (
            <dl className="mt-1.5 space-y-0.5">
              {m.supporting.map((s) => (
                <div key={s.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2" title={s.how}>
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="font-mono text-foreground">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 font-mono uppercase tracking-label text-muted-foreground">
            <span>Reading</span>
            <span className="rounded-full border-hair px-1.5 py-px text-[8px] normal-case tracking-normal" title="Written by the app from the measurement: not a human judgment, not a simulation">
              {interpretation.edited ? "edited by you" : "generated"}
            </span>
          </div>
          {onInterpretation ? (
            <div className="mt-1 flex items-start gap-1.5">
              <textarea
                key={interpretation.text}
                defaultValue={interpretation.text}
                onBlur={(e) => e.target.value.trim() !== interpretation.text.trim() && onInterpretation(e.target.value === result.interpretation.text ? "" : e.target.value)}
                rows={Math.min(8, Math.max(3, Math.ceil(interpretation.text.length / 62)))}
                className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring"
                aria-label={`Reading of ${c.name}`}
              />
              {interpretation.edited && (
                <button type="button" onClick={() => onInterpretation("")} className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" title="Back to the generated reading" aria-label="Back to the generated reading">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <p className="mt-0.5 leading-relaxed text-foreground">{interpretation.text}</p>
          )}
          {scale && idx !== undefined && !interpretation.edited && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1" title="Where the value falls, in the app's own words (its thresholds, not the matrix's)">
              {scale.map((s, i) => (
                <span key={s} className={cn("rounded-full px-2 py-0.5 text-[10px]", i === idx ? "bg-gradient-to-r from-magenta to-orange font-medium text-white" : "border-hair text-muted-foreground")}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        <details className="rounded-md border-hair px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">How it was measured, and what it cannot show</summary>
          <div className="mt-1.5 space-y-1.5 leading-relaxed text-muted-foreground">
            <p>{m.method || "—"}</p>
            <p>
              <span className="text-foreground">Cannot establish: </span>
              {m.cannot || "—"}
            </p>
            {m.used.length > 0 && (
              <p>
                <span className="text-foreground">Assumptions used: </span>
                {m.used.join(" · ")}
              </p>
            )}
          </div>
        </details>

        <details className="rounded-md border-hair px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">The matrix&apos;s own words</summary>
          <dl className="mt-1.5 space-y-1.5 leading-relaxed">
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-label text-muted-foreground">Qualitative criterion</dt>
              <dd>{c.qualitative}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-label text-muted-foreground">Quantitative criterion</dt>
              <dd>{c.quantitative}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-label text-muted-foreground">Precedent</dt>
              <dd>{c.precedent}</dd>
            </div>
          </dl>
        </details>

        {extra}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {onEvidence && hasEvidence ? (
            <button
              type="button"
              onClick={onEvidence}
              aria-pressed={evidenceOn}
              className={cn(
                "flex items-center gap-1.5 rounded-md border-hair px-2 py-1 font-mono text-[10px] uppercase tracking-label transition-colors",
                evidenceOn ? "border-orange/60 bg-orange/10 text-foreground" : "text-muted-foreground hover:border-white/30 hover:text-foreground",
              )}
              title="Light up, in the views, what this reading is about"
            >
              <Crosshair className="h-3 w-3" />
              {evidenceOn ? "Showing evidence" : "Evidence"}
            </button>
          ) : (
            <span />
          )}
          <span className="font-mono text-[10px] text-muted-foreground" title="The app's older blend of proxies for this descriptor, 0-100. It is not the matrix measurement and is not used to choose criteria.">
            presence index {Math.round(result.legacy.score)}
          </span>
        </div>
      </div>
    </div>
  );
}
