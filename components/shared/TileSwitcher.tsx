"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/lib/project-store";

export function TileSwitcher() {
  const { tiles, activeTileId, setActiveTile, removeTile } = useProject();

  if (!tiles.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
      {tiles.map((tile) => (
        <div
          key={tile.id}
          onClick={() => setActiveTile(tile.id)}
          className={cn(
            "group flex cursor-pointer items-center gap-2 rounded-full border-hair py-1 pl-3 pr-1.5 text-xs transition-colors",
            activeTileId === tile.id
              ? "border-magenta/50 bg-magenta/10 text-foreground"
              : "text-muted-foreground hover:border-white/25 hover:text-foreground",
          )}
        >
          <span className="max-w-[16ch] truncate">{tile.name}</span>
          <button
            aria-label={`Close ${tile.name}`}
            onClick={(e) => {
              e.stopPropagation();
              removeTile(tile.id);
            }}
            className="rounded-full p-0.5 opacity-60 hover:bg-white/10 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
