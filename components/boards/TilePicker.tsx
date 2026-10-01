"use client";

import { useProject } from "@/lib/project-store";
import { cn } from "@/lib/utils";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { MAX_TILES, type BoardSlot } from "@/lib/boards/types";

export function TilePicker({ slots, onToggle }: { slots: BoardSlot[]; onToggle: (tileId: string) => void }) {
  const { tiles } = useProject();
  const activeTileIds = new Set(slots.map((s) => s.tileId).filter((id): id is string => !!id));

  if (!tiles.length) {
    return <p className="text-xs text-muted-foreground">No tiles in this project yet -- load some in the Viewer tab first.</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="mb-1 text-[11px] text-muted-foreground">
        {activeTileIds.size}/{MAX_TILES} on the board
      </div>
      {tiles.map((tile) => {
        const active = activeTileIds.has(tile.id);
        const disabled = !active && activeTileIds.size >= MAX_TILES;
        return (
          <label
            key={tile.id}
            className={cn(
              "flex items-center gap-2 rounded-md border-hair px-2.5 py-1.5 text-xs transition-colors",
              active ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25",
              disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
            )}
          >
            <input type="checkbox" className="accent-[var(--magenta)]" checked={active} disabled={disabled} onChange={() => onToggle(tile.id)} />
            <TileThumbnail glbUrl={tile.glbUrl} size={22} />
            <span className="truncate">{tile.name}</span>
          </label>
        );
      })}
    </div>
  );
}
