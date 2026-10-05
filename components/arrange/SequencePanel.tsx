"use client";

import { ArrowDown, MapPin, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { cn } from "@/lib/utils";
import { categoryOf } from "@/lib/arrange/orient";
import { CATEGORY_LABEL } from "@/lib/arrange/types";
import { scoreTone, Cap } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

/** The main route from the entrance as a strip of spaces, with the score of each joint between them. */
export function SequencePanel() {
  const A = useArrange();
  const seq = A.sequence;
  if (!seq.steps.length) return <p className="text-xs text-muted-foreground">Place pieces and mark an entrance (E, then click a piece) to read the sequence.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{seq.steps.length} spaces along the main route</span>
        <span className="font-mono">quality {seq.quality}</span>
      </div>
      <div className="space-y-0.5">
        {seq.steps.map((s, i) => {
          const b = A.layout.byId.get(s.pieceId);
          if (!b) return null;
          return (
            <div key={s.pieceId}>
              {s.joint && (
                <div className="flex items-center gap-1.5 py-0.5 pl-6 font-mono text-[10px]" style={{ color: scoreTone(s.joint.score) }}>
                  <ArrowDown className="h-3 w-3" />
                  {s.joint.score === null ? "sealed" : s.joint.score.toFixed(0)}
                </div>
              )}
              <button type="button" onClick={() => A.pick(s.pieceId, false)} className={cn("flex w-full items-center gap-2 rounded-md border-hair px-2 py-1.5 text-left text-xs", A.sel.has(s.pieceId) ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25")}>
                <span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                <TileThumbnail glbUrl={b.tile.glbUrl} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{A.nameOf(s.pieceId)}</span>
                  <span className="block text-[10px] text-muted-foreground">{CATEGORY_LABEL[categoryOf(b.tile)]}</span>
                </span>
                {s.pieceId === A.layout.entranceId && <MapPin className="h-3.5 w-3.5 shrink-0 text-orange" aria-label="Entrance" />}
              </button>
            </div>
          );
        })}
      </div>
      {seq.branches.length > 0 && <p className="text-[10px] text-muted-foreground">{seq.branches.length} more piece{seq.branches.length === 1 ? "" : "s"} branch off the route.</p>}
      <Button variant="outline" size="sm" className="w-full" onClick={() => A.setMode("entrance")}>
        <MapPin className="mr-1.5 h-3.5 w-3.5" />
        Mark the entrance
      </Button>
    </div>
  );
}

/** Names for the spaces: proposed from each tile and its place in the route; edit any before adding as a tile or exporting. */
export function SpacesPanel() {
  const A = useArrange();
  const ids = [...A.sequence.steps.map((s) => s.pieceId), ...A.shown.pieces.map((p) => p.id).filter((id) => !A.sequence.steps.some((s) => s.pieceId === id))];
  if (!ids.length) return <p className="text-xs text-muted-foreground">No spaces yet.</p>;
  return (
    <div className="space-y-2">
      <Cap>Edit any name; it is kept in the saved tile, the drawings and the report.</Cap>
      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {ids.map((id) => {
          const b = A.layout.byId.get(id);
          const custom = A.doc.names[id];
          return (
            <div key={id} className="flex items-center gap-2">
              {b && <TileThumbnail glbUrl={b.tile.glbUrl} size={22} />}
              <input
                defaultValue={custom ?? A.autoName[id] ?? ""}
                key={`${id}-${custom ?? A.autoName[id] ?? ""}`}
                placeholder={A.autoName[id]}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== (custom ?? A.autoName[id])) A.rename(id, v);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                aria-label="Space name"
                className={cn("h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring", A.sel.has(id) && "border-magenta/50")}
                onFocus={() => A.pick(id, false)}
              />
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={A.autoNameAll}>
        <Wand2 className="mr-1.5 h-3.5 w-3.5" />
        Auto-name all
      </Button>
    </div>
  );
}
