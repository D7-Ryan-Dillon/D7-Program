"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { categoryOf, isPlaceable } from "@/lib/arrange/orient";
import { CATEGORY_LABEL } from "@/lib/arrange/types";
import { Chip } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

/** The tiles that can be used: check the ones the generator may use, or click + to place one by hand. */
export function BankPanel() {
  const A = useArrange();
  const [filter, setFilter] = useState<string>("all");
  const checked = useMemo(() => new Set(A.ui.selected), [A.ui.selected]);
  const toggle = (id: string) => A.patchUi({ selected: checked.has(id) ? A.ui.selected.filter((x) => x !== id) : [...A.ui.selected, id] });

  if (!A.tiles.length) return <p className="text-xs text-muted-foreground">Load tiles in the Viewer tab first, then check the ones to include here.</p>;

  const cats = ["all", ...new Set(A.tiles.map((t) => (t.meta?.category === "assembly" ? "assembly" : categoryOf(t))))];
  const shown = A.tiles.filter((t) => filter === "all" || (t.meta?.category === "assembly" ? "assembly" : categoryOf(t)) === filter);
  const allShown = shown.length > 0 && shown.every((t) => checked.has(t.id));

  return (
    <div className="space-y-2">
      {cats.length > 2 && (
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {c === "all" ? "All" : c === "assembly" ? "Assemblies" : CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]}
            </Chip>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" className="h-6 w-full justify-start px-1 text-[11px] uppercase tracking-label text-muted-foreground" onClick={() => A.patchUi({ selected: allShown ? A.ui.selected.filter((id) => !shown.some((t) => t.id === id)) : [...new Set([...A.ui.selected, ...shown.map((t) => t.id)])] })}>
        {allShown ? "Uncheck these" : "Check these"}
      </Button>
      {shown.map((tile) => {
        const ok = isPlaceable(tile);
        return (
          <div key={tile.id} className={cn("flex items-center gap-2 rounded-md border-hair px-2 py-1.5 text-xs transition-colors", checked.has(tile.id) ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25", !ok && "opacity-50")}>
            <input type="checkbox" className="accent-[var(--magenta)]" checked={checked.has(tile.id)} onChange={() => toggle(tile.id)} disabled={!ok} aria-label={`Use ${tile.name}`} />
            <TileThumbnail glbUrl={tile.glbUrl} size={22} />
            <span className="min-w-0 flex-1 truncate" title={ok ? tile.name : `${tile.name}: can't be placed (needs voxels at the standard 0.5 ft cell, a box shape)`}>
              {tile.name}
            </span>
            <button type="button" disabled={!ok} title="Place this tile now" aria-label={`Place ${tile.name}`} onClick={() => A.addTile(tile.id)} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
