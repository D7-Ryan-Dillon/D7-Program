"use client";

import { Crosshair } from "lucide-react";
import { Section } from "@/components/shared/Section";
import { cn } from "@/lib/utils";
import type { Evidence } from "@/lib/scoring/descriptors";
import type { UsableSpace } from "@/lib/scoring/usable";
import { ft, ft2, ft3, num } from "@/lib/scoring/words";

const Pair = ({ label, a, b, note }: { label: string; a: string; b: string; note: string }) => (
  <div className="rounded-md border-hair px-2.5 py-2" title={note}>
    <div className="font-mono text-[9px] uppercase tracking-label text-muted-foreground">{label}</div>
    <div className="mt-0.5 text-xs">
      <span className="font-mono text-foreground">{a}</span>
      <span className="text-muted-foreground"> against </span>
      <span className="font-mono text-pink">{b}</span>
    </div>
    <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{note}</div>
  </div>
);

/**
 * What can be used, as against what is carved: total void against the void over floor that can be reached on foot; plate area against floor that is
 * exposed and usable; open space joined against floors joined; a view between levels against a way up. Problems are shown where they are (a floor too
 * narrow or too low to walk on, a floor with no way to it), not as an average. The thresholds are those Arrange uses for its walkable routes, for
 * proto-architecture: they are not structural, accessibility or code checks.
 */
export function UsablePanel({ usable, name, onShow, showing }: { usable: UsableSpace; name: string; onShow?: (ev: Evidence | null, what: string) => void; showing?: string | null }) {
  const t = usable.thresholds;
  const show = (what: string, regions: { min: number[]; max: number[] }[]) => onShow?.(showing === what ? null : { regions }, showing === what ? "" : what);
  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.usable" title="Usable space" summary={usable.available ? `${ft2(usable.usableFt2)} of floor you can walk to` : "not assessable"} defaultOpen>
        {!usable.available ? (
          <p className="text-[11px] text-muted-foreground">{usable.reason}</p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              {name}: carved space is not all usable. Floor needs {ft(t.headroomFt, 1)} of headroom and a {ft(t.widthFt, 1)} clear width, steps of no more than {ft(t.stepFt, 1)}, and a way to it from an opening at ground level. Proto-architectural thresholds, not a structural, accessibility or code check.
              {usable.reason && ` ${usable.reason}`}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Pair label="Void and reachable space" a={`${ft3(usable.voidFt3)} carved`} b={`${ft3(usable.reachableVoidFt3)} above floor you can reach`} note="Reachable: the void above floor that can be walked to from the way in." />
              <Pair label="Plates and usable floor" a={`${ft2(usable.plateFt2)} of plate`} b={`${ft2(usable.usableFt2)} exposed and usable`} note={`Of ${ft2(usable.floorFt2)} of floor in all: ${ft2(usable.cutOffFt2)} you could stand on but cannot get to, ${ft2(usable.tightFt2)} too narrow or too low.`} />
              <Pair label="Void connectivity and circulation" a={`${usable.voidPieces} void piece${usable.voidPieces === 1 ? "" : "s"}`} b={`${usable.zonesReached} of ${usable.zones} floor zones joined to the way in`} note="Open space joined is not the same as floors joined: a floor zone is one area you can walk across." />
              <Pair label="Views between levels and ways up" a={`${usable.verticalVisual} void link${usable.verticalVisual === 1 ? "" : "s"} between levels`} b={usable.verticalTraversable ? `${usable.levelsReached} of ${usable.levelsTotal} levels reached on foot` : `${usable.levelsReached} of ${usable.levelsTotal} levels reached on foot: no stair or ramp joins them`} note="A void that links two levels is a view; it is a way only where a stair or ramp joins the floors." />
            </div>
            <div className="flex flex-wrap gap-2">
              {usable.tight.length > 0 && (
                <button type="button" onClick={() => show("tight", usable.tight)} className={cn("flex items-center gap-1.5 rounded-md border-hair px-2 py-1 font-mono text-[10px] uppercase tracking-label", showing === "tight" ? "border-orange/60 bg-orange/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <Crosshair className="h-3 w-3" />
                  {usable.tight.length} clearance problem{usable.tight.length === 1 ? "" : "s"} · {ft2(usable.tight.reduce((a, r) => a + r.areaFt2, 0))}
                </button>
              )}
              {usable.cutOff.length > 0 && (
                <button type="button" onClick={() => show("cutoff", usable.cutOff)} className={cn("flex items-center gap-1.5 rounded-md border-hair px-2 py-1 font-mono text-[10px] uppercase tracking-label", showing === "cutoff" ? "border-orange/60 bg-orange/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <Crosshair className="h-3 w-3" />
                  {usable.cutOff.length} unreachable area{usable.cutOff.length === 1 ? "" : "s"} · {ft2(usable.cutOff.reduce((a, r) => a + r.areaFt2, 0))}
                </button>
              )}
              {usable.tight.length === 0 && usable.cutOff.length === 0 && <span className="text-[11px] text-muted-foreground">No clearance problem and no unreachable floor was found.</span>}
            </div>
            {usable.tight[0] && (
              <p className="text-[10px] text-muted-foreground">
                Largest clearance problem: {ft2(usable.tight[0].areaFt2)} around ({num(usable.tight[0].min[0])}–{num(usable.tight[0].max[0])}, {num(usable.tight[0].min[1])}–{num(usable.tight[0].max[1])}) ft.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
