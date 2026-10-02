"use client";

import { useMemo } from "react";
import { Menu } from "@base-ui/react/menu";
import { Pin, ChevronDown, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/lib/project-store";
import { TileThumbnail } from "./TileThumbnail";

/** The loaded-tiles bar at the top of Viewer/Analysis -- a single
 * horizontally-scrolling row (rather than wrapping to as many rows as it
 * takes) so a large bank stays a fixed, small height. Pinned tiles are
 * reordered to the front of that row so they're always the first thing
 * visible without scrolling; the dropdown on the right is where tiles get
 * pinned or unpinned. */
export function TileSwitcher() {
  const { tiles, activeTileId, setActiveTile, removeTile, pinnedTileIds, togglePinned } = useProject();

  const ordered = useMemo(() => {
    const pinnedSet = new Set(pinnedTileIds);
    const pinned = tiles.filter((t) => pinnedSet.has(t.id));
    const rest = tiles.filter((t) => !pinnedSet.has(t.id));
    return [...pinned, ...rest];
  }, [tiles, pinnedTileIds]);

  if (!tiles.length) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {ordered.map((tile) => {
          const pinned = pinnedTileIds.includes(tile.id);
          return (
            <div
              key={tile.id}
              onClick={() => setActiveTile(tile.id)}
              className={cn(
                "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-hair py-1 pl-1.5 pr-1.5 text-xs transition-colors",
                activeTileId === tile.id
                  ? "border-magenta/50 bg-magenta/10 text-foreground"
                  : "text-muted-foreground hover:border-white/25 hover:text-foreground",
              )}
            >
              <TileThumbnail glbUrl={tile.glbUrl} size={22} className="rounded-full" />
              {tile.sectionRecipe?.plates?.enabled && (
                <span className="shrink-0 rounded bg-magenta/70 px-1 font-mono text-[9px] leading-tight text-white" title={`${tile.sectionRecipe.plates.count} floor plate(s)`}>
                  ▤{tile.sectionRecipe.plates.count}
                </span>
              )}
              {pinned && <Pin className="h-2.5 w-2.5 shrink-0 fill-current text-magenta" aria-label="Pinned" />}
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
          );
        })}
      </div>

      <Menu.Root>
        <Menu.Trigger
          aria-label="Pin tiles to the front"
          className="flex shrink-0 items-center gap-1 rounded-full border-hair px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
        >
          <Pin className="h-3 w-3" />
          <ChevronDown className="h-3 w-3" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6}>
            <Menu.Popup className="max-h-80 w-64 overflow-y-auto rounded-lg border-hair bg-popover p-1 text-popover-foreground shadow-lg">
              <div className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Pin to front</div>
              {tiles.map((tile) => (
                <Menu.CheckboxItem
                  key={tile.id}
                  checked={pinnedTileIds.includes(tile.id)}
                  onCheckedChange={() => togglePinned(tile.id)}
                  closeOnClick={false}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-white/10"
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <Menu.CheckboxItemIndicator>
                      <Check className="h-3.5 w-3.5 text-magenta" />
                    </Menu.CheckboxItemIndicator>
                  </span>
                  <TileThumbnail glbUrl={tile.glbUrl} size={22} />
                  <span className="truncate">{tile.name}</span>
                </Menu.CheckboxItem>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
