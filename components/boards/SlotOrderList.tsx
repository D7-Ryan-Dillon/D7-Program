"use client";

import { ChevronUp, ChevronDown, X } from "lucide-react";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { Select } from "@/components/ui/select";
import { displayName, type BoardSlot, type BoardViewMode } from "@/lib/boards/types";
import type { ParsedTile } from "@/lib/types";

/** The order tiles appear on the board follows `config.slots` -- this lets
 * that order be rearranged directly, rather than only by removing and
 * re-adding tiles in the desired sequence. */
export function SlotOrderList({
  slots,
  tileById,
  onMove,
  onRemove,
  onView,
}: {
  slots: BoardSlot[];
  tileById: Map<string, ParsedTile>;
  onMove: (slotId: string, direction: "up" | "down") => void;
  onRemove: (slotId: string) => void;
  /** Overrides what this tile shows (undefined = follow the board). */
  onView?: (slotId: string, mode: BoardViewMode | undefined) => void;
}) {
  if (!slots.length) {
    return <p className="text-xs text-muted-foreground">Check tiles below to add them to the board.</p>;
  }

  return (
    <ol className="space-y-1">
      {slots.map((slot, i) => {
        const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
        return (
          <li key={slot.id} className="flex items-center gap-1 rounded-md border-hair bg-white/[0.02] px-2 py-1.5 text-xs">
            <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{i + 1}</span>
            {tile && <TileThumbnail glbUrl={tile.glbUrl} size={22} />}
            <span className="min-w-0 flex-1 truncate">{tile ? displayName(tile.name) : "—"}</span>
            {onView && (
              <Select className="h-6 w-[4.6rem] shrink-0 px-1 text-[10px]" value={slot.drawing?.mode ?? "default"} onChange={(e) => onView(slot.id, e.target.value === "default" ? undefined : (e.target.value as BoardViewMode))} aria-label={`What ${tile?.name ?? "this tile"} shows`} title="3D, plan or section for this tile (default follows the board)">
                <option value="default">Board</option>
                <option value="model">3D</option>
                <option value="plan">Plan</option>
                <option value="section">Section</option>
              </Select>
            )}
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              disabled={i === 0}
              onClick={() => onMove(slot.id, "up")}
              aria-label={`Move ${tile?.name ?? "tile"} earlier`}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              disabled={i === slots.length - 1}
              onClick={() => onMove(slot.id, "down")}
              aria-label={`Move ${tile?.name ?? "tile"} later`}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
              onClick={() => onRemove(slot.id)}
              aria-label={`Remove ${tile?.name ?? "tile"} from board`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
