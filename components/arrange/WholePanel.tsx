"use client";

import { AlertTriangle, Info, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bar, Cap, Chip } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";
import { CATEGORY_LABEL } from "@/lib/arrange/types";

const pct = (v: number) => `${Math.round(v * 100)}%`;

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("font-mono tabular-nums", tone === "ok" && "text-pink", tone === "warn" && "text-orange", tone === "bad" && "text-destructive")}>{value}</span>
  </div>
);

/** The verdict on the arrangement as one building, and the evidence behind each finding (click one to light it up in 3D). */
export function WholePanel() {
  const A = useArrange();
  const w = A.whole;
  const s = w.summary;
  const seq = A.sequence;

  if (!A.layout.boxes.length) return <p className="text-xs text-muted-foreground">Place or generate pieces to see how the whole reads.</p>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Stat label="Pieces" value={String(A.layout.boxes.length)} />
        <Stat label="Connected" value={A.layout.islands.length === 0 ? "one mass" : `${A.layout.islands.length} detached`} tone={A.layout.islands.length === 0 ? "ok" : "bad"} />
        <Stat label="Walkable from the entrance" value={A.layout.unreachable.length === 0 && A.layout.islands.length === 0 ? "all pieces" : `${A.layout.unreachable.length + A.layout.islands.flat().length} cut off`} tone={A.layout.unreachable.length === 0 && A.layout.islands.length === 0 ? "ok" : "warn"} />
        <Stat label="Sequence" value={seq.steps.length ? `${seq.steps.length} spaces · ${seq.quality}` : "no entrance route"} tone={seq.quality >= 60 ? "ok" : "warn"} />
      </div>

      {w.status === "working" && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Reading the whole…
        </p>
      )}
      {w.status === "skipped" && (
        <div className="space-y-1.5 rounded-md border-hair p-2 text-[11px] text-muted-foreground">
          This arrangement is large ({(w.cells / 1e6).toFixed(1)} M cells), so the full reading is on demand.
          <Button size="sm" variant="outline" className="mt-1 w-full" onClick={() => A.runWhole(true)}>
            Analyse in full
          </Button>
        </div>
      )}

      {s && (
        <>
          <div className="space-y-1 border-t border-border pt-2">
            <Stat label="Floor levels" value={`${s.levels}${s.levelHeights.length ? ` (${s.levelHeights.map((z) => z.toFixed(0)).join(", ")} ft)` : ""}`} />
            <Stat label="Longest route" value={s.mainRouteFt === null ? "none" : `${s.mainRouteFt.toFixed(0)} ft`} />
            <Stat label="Rooms" value={`${s.rooms} in ${s.roomComponents} group${s.roomComponents === 1 ? "" : "s"}`} tone={s.roomComponents > 1 ? "warn" : undefined} />
            <Stat label="Dead ends / loops" value={`${s.deadEnds} / ${s.loops}`} />
            <Stat label="Floor in daylight" value={`${pct(s.litFloor)} (${pct(s.skyFloor)} open sky)`} />
            <Stat label="Void share" value={pct(s.voidShare)} />
            <Stat label="Height · footprint" value={`${s.heightFt.toFixed(0)} ft · ${s.footprintFt[0].toFixed(0)} × ${s.footprintFt[1].toFixed(0)}`} />
            <Stat label="Floating foam" value={s.foamPieces <= 1 ? "none" : `${s.foamPieces - 1} piece${s.foamPieces - 1 === 1 ? "" : "s"}, ${s.floatingFt3.toFixed(0)} ft³`} tone={s.foamPieces <= 1 ? "ok" : "warn"} />
            <Stat label="Mix" value={Object.entries(s.categories).map(([c, n]) => `${n} ${CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]?.toLowerCase() ?? c}`).join(", ")} />
          </div>

          <div className="space-y-1.5 border-t border-border pt-2">
            <Cap>Print checks</Cap>
            {s.checks.map((c) => (
              <div key={c.key} className="flex items-start gap-1.5 text-[11px]" title={c.detail}>
                <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", c.status === "ok" ? "bg-pink" : c.status === "warn" ? "bg-orange" : "bg-destructive")} />
                <span className="text-muted-foreground">
                  <span className="text-foreground">{c.label}</span> · {c.detail}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 border-t border-border pt-2">
            <Cap>Descriptors on the whole</Cap>
            {s.descriptors.map((d) => (
              <div key={d.key} className="space-y-0.5">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="truncate text-muted-foreground">{d.label}</span>
                  <span className="font-mono tabular-nums">{d.score}</span>
                </div>
                <Bar value={d.score} color={d.score >= 66 ? "#db7228" : "#9a9a9a"} />
              </div>
            ))}
          </div>
        </>
      )}

      {w.evidence.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <Cap>Evidence (light it up)</Cap>
          <div className="space-y-1">
            {w.evidence.map((e) => (
              <button key={e.key} type="button" onClick={() => A.setEvidenceKey(A.evidenceKey === e.key ? null : e.key)} className={cn("w-full rounded-md border-hair px-2 py-1.5 text-left text-[11px] transition-colors", A.evidenceKey === e.key ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25")}>
                <div className="text-foreground">{e.label}</div>
                <div className="text-muted-foreground">{e.detail}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ICON = { error: XCircle, warn: AlertTriangle, info: Info };
const TONE = { error: "text-destructive", warn: "text-orange", info: "text-muted-foreground" };

/** Everything the arrangement breaks or risks, worst first; click one to frame it. */
export function WarningsPanel() {
  const A = useArrange();
  const list = A.warnings;
  const click = (ids: string[], joint?: string) => {
    if (joint) {
      A.setSelJoint(joint);
    }
    if (ids.length) {
      A.setHighlight(new Set(ids));
      const boxes = ids.map((i) => A.layout.byId.get(i)).filter((b): b is NonNullable<typeof b> => !!b);
      if (boxes.length) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const b of boxes) for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], b.min[k] * 0.5);
          max[k] = Math.max(max[k], b.max[k] * 0.5);
        }
        A.focusOn([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
      }
    }
  };
  return (
    <details className="group" open={list.some((w) => w.severity === "error")}>
      <summary className="flex cursor-pointer items-center justify-between font-mono text-[11px] uppercase tracking-label text-muted-foreground hover:text-foreground">
        <span>Warnings</span>
        <span className={cn("normal-case tracking-normal", list.some((w) => w.severity === "error") ? "text-destructive" : list.length ? "text-orange" : "text-pink")}>{list.length ? `${list.length}` : "none"}</span>
      </summary>
      <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
        {list.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing is broken or at risk.</p>}
        {list.map((w) => {
          const Icon = ICON[w.severity];
          return (
            <button key={w.id} type="button" onClick={() => click(w.pieceIds, w.jointId)} className="flex w-full items-start gap-1.5 rounded-md border-hair px-2 py-1.5 text-left text-[11px] hover:border-white/25">
              <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", TONE[w.severity])} />
              <span className="text-muted-foreground">{w.message}</span>
            </button>
          );
        })}
        {(A.layout.islands.length > 0 || A.layout.overlaps.length > 0) && (
          <Chip onClick={() => A.setHighlight(new Set([...A.layout.islands.flat(), ...A.layout.overlaps.flat()]))}>Highlight the problem pieces</Chip>
        )}
      </div>
    </details>
  );
}
