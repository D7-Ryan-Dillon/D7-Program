"use client";

import { RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ratingFor, type Joint } from "@/lib/arrange/types";
import { connectorNeeds } from "@/lib/arrange/connectors";
import { Bar, scoreTone } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

const WORD = { interlocks: "text-pink", partial: "text-orange", poor: "text-destructive", sealed: "text-muted-foreground" };

const PART_LABEL: { key: keyof Joint["parts"]; label: string }[] = [
  { key: "void", label: "Void" },
  { key: "floors", label: "Floors" },
  { key: "circulation", label: "Routes" },
  { key: "foam", label: "Foam" },
];

/** A joint whose floors are a doorway apart: what a connector would need, the one that is built, and the buttons to build or take it out. */
function ConnectorLine({ j }: { j: Joint }) {
  const A = useArrange();
  const made = A.layout.connectors.find((c) => c.jointId === j.id);
  const failed = A.layout.connectorFails.find((c) => c.jointId === j.id);
  const choice = A.doc.connectors?.[j.id];
  if (made) {
    return (
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-mono text-pink" title="A wedge of floor built into the lower room, worked out again from the pieces whenever they move">
          {made.kind} built · {made.riseFt.toFixed(1)} ft up over {made.runFt.toFixed(1)} ft, {made.widthFt.toFixed(1)} ft wide{made.auto ? " (automatic)" : ""}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            A.setConnector(j.id, made.auto ? { kind: "auto", off: true } : null);
          }}
          className="rounded border-hair px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
        >
          Remove
        </button>
      </div>
    );
  }
  if (j.connect.kind !== "connector" || !j.connect.connector) return choice?.off ? <div className="text-[10px] text-muted-foreground">connector taken out here</div> : null;
  const need = connectorNeeds(j.connect.connector.riseFt);
  return (
    <div className="space-y-1 text-[10px]">
      <div>
        A stair up {j.connect.connector.riseFt.toFixed(1)} ft needs about {need.stairFt.toFixed(0)} ft of run in the lower room, a ramp about {need.rampFt.toFixed(0)} ft.
        {failed ? <span className="text-orange"> {failed.why}.</span> : null}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          A.setConnector(j.id, { kind: "auto" });
        }}
        className="rounded border-hair px-1.5 py-0.5 text-foreground hover:border-white/30"
      >
        Add a connector
      </button>
    </div>
  );
}

/** Every place two pieces touch, worst first, with the four parts of the score. Thumbs mark joints good or bad for "Regenerate marked". */
export function JointsPanel() {
  const A = useArrange();
  const joints = [...A.joints].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const bad = Object.values(A.doc.ratings).filter((r) => r === "bad").length;
  if (!joints.length) return <p className="text-xs text-muted-foreground">No joints yet: pieces that touch make one.</p>;

  const select = (j: Joint) => {
    A.setSelJoint(j.id);
    A.setHighlight(new Set([j.aId, j.bId]));
    A.focusOn([(j.min[0] + j.max[0]) / 2, (j.min[1] + j.max[1]) / 2, (j.min[2] + j.max[2]) / 2], 14);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {joints.map((j) => {
          const r = ratingFor(j.score);
          return (
            <div key={j.id} role="button" tabIndex={0} onClick={() => select(j)} onKeyDown={(e) => e.key === "Enter" && select(j)} className={cn("cursor-pointer space-y-1.5 rounded-md border-hair px-2.5 py-2 text-xs transition-colors", A.selJoint === j.id ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25")}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate">
                    {A.nameOf(j.aId)} · {A.nameOf(j.bId)}
                  </div>
                  <div className={cn("font-mono text-[11px]", WORD[r])}>
                    {j.score === null ? "sealed" : `${j.score.toFixed(0)} · ${r}`}
                    <span className="text-muted-foreground"> · {j.axis === 2 ? "stacked" : "side by side"}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  <button aria-label="Mark good" onClick={() => A.rateJoint(j.id, A.doc.ratings[j.id] === "good" ? null : "good")} className={cn("rounded-full p-1.5 hover:bg-white/10", A.doc.ratings[j.id] === "good" && "bg-pink/20 text-pink")}>
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button aria-label="Mark bad" onClick={() => A.rateJoint(j.id, A.doc.ratings[j.id] === "bad" ? null : "bad")} className={cn("rounded-full p-1.5 hover:bg-white/10", A.doc.ratings[j.id] === "bad" && "bg-destructive/20 text-destructive")}>
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {PART_LABEL.map((p) => (
                  <div key={p.key} title={`${p.label}: ${j.parts[p.key] === null ? "does not apply here" : j.parts[p.key]!.toFixed(0)}`}>
                    <div className="mb-0.5 text-[9px] uppercase tracking-label text-muted-foreground">{p.label}</div>
                    <Bar value={j.parts[p.key]} color={scoreTone(j.parts[p.key])} />
                  </div>
                ))}
              </div>
              {j.floorStepFt !== null && j.floorStepFt > 0.01 && <div className="text-[10px] text-muted-foreground">floors differ by up to {j.floorStepFt.toFixed(1)} ft</div>}
              {/* three different things: the pieces touch, open space continues, a person can walk it */}
              <div className="space-y-0.5 text-[10px] text-muted-foreground">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                  <span title="the pieces touch face to face">touch {j.connect.contactFt2.toFixed(0)} ft2{j.patches.length > 1 ? ` in ${j.patches.length} patches` : ""}</span>
                  <span title="open space meets open space across the joint" className={j.connect.voidConnected ? "text-foreground" : ""}>open {j.connect.voidFt2.toFixed(0)} ft2</span>
                  <span title="a person can stand on a floor on each side and step across" className={j.connect.walkable ? "text-pink" : "text-orange"}>
                    {j.connect.walkable ? `walkable${j.connect.stepFt ? ` · step ${j.connect.stepFt.toFixed(1)} ft` : ""}` : j.connect.kind === "connector" ? `needs a connector · ${j.connect.connector!.riseFt.toFixed(1)} ft rise · not walkable` : j.connect.kind === "void" ? "not walkable" : "no route"}
                  </span>
                </div>
                {!j.connect.walkable && j.connect.why && <div>{j.connect.why}</div>}
                <ConnectorLine j={j} />
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="w-full" disabled={bad === 0 || !!A.busy} onClick={A.regenerate}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Regenerate marked ({bad})
      </Button>
    </div>
  );
}
