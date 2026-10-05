"use client";

import { Copy, FolderOpen, Plus, Trash2, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { analyzeLayout } from "@/lib/arrange/layout";
import { overallScore } from "@/lib/arrange/joints";
import { useArrange } from "@/components/arrange/useArrange";
import { useMemo } from "react";

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Every arrangement you build stays here with the project, whether or not it was ever added to the tile bank. */
export function SavedPanel() {
  const A = useArrange();
  const rows = useMemo(
    () =>
      A.ui.saved.map((s) => {
        const l = analyzeLayout(s.doc, A.tileById, s.rules ?? A.ui.rules);
        return { s, pieces: s.doc.pieces.length, score: overallScore(l.joints), valid: s.doc.pieces.length > 0 && l.islands.length === 0 && l.overlaps.length === 0 };
      }),
    [A.ui.saved, A.tileById, A.ui.rules],
  );

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" className="w-full" onClick={A.newArrangement}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        New arrangement
      </Button>
      {A.ui.currentId === null && A.doc.pieces.length === 0 && <p className="text-[11px] text-muted-foreground">Place a piece or generate, and it is saved here automatically.</p>}
      {rows.length === 0 && A.doc.pieces.length > 0 && <p className="text-[11px] text-muted-foreground">Saving…</p>}
      {rows
        .slice()
        .sort((a, b) => b.s.updatedAt - a.s.updatedAt)
        .map(({ s, pieces, score, valid }) => {
          const current = s.id === A.ui.currentId;
          return (
            <div key={s.id} className={cn("flex gap-2 rounded-md border-hair p-2", current ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25")}>
              <div className="h-[44px] w-[66px] shrink-0 overflow-hidden rounded bg-white/5">
                {s.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.thumb} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  value={s.name}
                  onChange={(e) => A.renameArrangement(s.id, e.target.value)}
                  aria-label="Arrangement name"
                  className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-xs outline-none hover:border-input focus:border-ring"
                />
                <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground">
                  <span>{pieces} pcs</span>
                  <span>{score === null ? "no score" : `joints ${score.toFixed(0)}`}</span>
                  <span className={valid ? "text-pink" : "text-orange"}>{valid ? "connected" : "needs fixing"}</span>
                  <span>{when(s.updatedAt)}</span>
                  {s.tileId && A.tileById.has(s.tileId) && <span className="text-pink">in bank</span>}
                </div>
                <div className="flex gap-1">
                  {!current && (
                    <button type="button" aria-label="Open" title="Open" onClick={() => A.openArrangement(s.id)} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground">
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => A.duplicateArrangement(s.id)} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {current && (
                    <button type="button" aria-label="Add as tile" title="Add as a tile" onClick={() => void A.addAsTile()} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground">
                      <Box className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" aria-label="Delete" title="Delete" onClick={() => A.deleteArrangement(s.id)} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}
