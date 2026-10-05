"use client";

import { Loader2, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { cn } from "@/lib/utils";
import { FACE_AXIS } from "@/lib/arrange/orient";
import { Cap, Chip } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

const FACE_WORD: Record<string, string> = { "x-": "west", "x+": "east", "y-": "south", "y+": "north", "z-": "underside", "z+": "roof" };

/** Suggest next / find best neighbour, fill the gap, and auto replace: each lists real placements you can preview (a ghost in the viewport) and apply. */
export function HelperPanel() {
  const A = useArrange();
  const one = A.sel.size === 1 ? [...A.sel][0] : null;
  const gaps = A.layout.exposed
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => FACE_AXIS[e.face] !== 2 || e.face === "z+")
    .sort((a, b) => b.e.patch.cells - a.e.patch.cells)
    .slice(0, 8);
  const s = A.suggestions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" disabled={!!A.busy || !A.doc.pieces.length || !A.bank.length} onClick={() => A.suggestFor(one)}>
          {A.busy === "Looking" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          Suggest next{one ? " for selected" : ""}
        </Button>
        <Button size="sm" variant="outline" disabled={!!A.busy || !one || !A.bank.length} onClick={() => one && A.suggestReplace(one)}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Better tile for selected
        </Button>
      </div>
      {!A.bank.length && <p className="text-[11px] text-muted-foreground">Check tiles in the Bank: suggestions come from them.</p>}

      {gaps.length > 0 && (
        <div className="space-y-1.5">
          <Cap>Fill the gap: openings that lead outside</Cap>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {gaps.map(({ e, i }) => (
              <button key={i} type="button" disabled={!!A.busy || !A.bank.length} onClick={() => A.fillGap(i)} onMouseEnter={() => A.setHighlight(new Set([e.pieceId]))} onMouseLeave={() => A.setHighlight(new Set())} className="flex w-full items-center justify-between gap-2 rounded-md border-hair px-2 py-1.5 text-left text-[11px] hover:border-white/25 disabled:opacity-40">
                <span className="truncate">{A.nameOf(e.pieceId)}</span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {FACE_WORD[e.face]} · {(e.patch.cells * 0.25).toFixed(0)} ft²
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {s && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <Cap>{s.label}</Cap>
            <button type="button" aria-label="Close suggestions" onClick={A.clearSuggestions} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {s.kind !== "replace" &&
            s.items.map((it, i) => (
              <div key={i} onMouseEnter={() => A.setPreviewSuggestion(i)} className={cn("flex items-center gap-2 rounded-md border-hair px-2 py-1.5", A.previewSuggestion === i ? "border-magenta/50 bg-magenta/10" : "")}>
                <TileThumbnail glbUrl={it.tile.glbUrl} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{it.tile.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{it.note}</div>
                </div>
                <Button size="sm" variant="outline" className="h-7" onClick={() => A.applySuggestionAt(i)}>
                  Place
                </Button>
              </div>
            ))}
          {s.kind === "replace" &&
            s.replacements?.map((r, i) => (
              <div key={i} onMouseEnter={() => A.setPreviewSuggestion(i)} className={cn("flex items-center gap-2 rounded-md border-hair px-2 py-1.5", A.previewSuggestion === i ? "border-magenta/50 bg-magenta/10" : "")}>
                <TileThumbnail glbUrl={r.tile.glbUrl} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{r.tile.name}</div>
                  <div className={cn("font-mono text-[10px]", r.delta >= 0 ? "text-pink" : "text-muted-foreground")}>
                    {r.delta >= 0 ? "+" : ""}
                    {r.delta.toFixed(2)} on the whole
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7" onClick={() => A.applySuggestionAt(i)}>
                  Use
                </Button>
              </div>
            ))}
          {((s.kind !== "replace" && !s.items.length) || (s.kind === "replace" && !s.replacements?.length)) && <p className="text-[11px] text-muted-foreground">Nothing fits within the rules.</p>}
          <Chip onClick={A.clearSuggestions}>Dismiss</Chip>
        </div>
      )}
    </div>
  );
}
