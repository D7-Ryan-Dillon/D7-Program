"use client";

import { cn } from "@/lib/utils";
import type { ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "@/lib/arrange/types";

export function InstanceList({
  instances,
  tileById,
  selectedId,
  onSelect,
}: {
  instances: PlacedInstance[];
  tileById: Map<string, ParsedTile>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!instances.length) {
    return <p className="text-xs text-muted-foreground">No pieces placed yet — auto-generate, or add one manually.</p>;
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
      {instances.map((inst, i) => {
        const tile = tileById.get(inst.tileId);
        const active = inst.id === selectedId;
        return (
          <button
            key={inst.id}
            type="button"
            onClick={() => onSelect(inst.id)}
            title={tile?.name}
            className={cn(
              "w-full truncate rounded-md border-hair px-2.5 py-1.5 text-left text-[11px] transition-colors",
              active ? "border-magenta/50 bg-magenta/10 text-foreground" : "text-muted-foreground hover:border-white/25 hover:text-foreground",
            )}
          >
            {i + 1}. {tile?.name ?? inst.tileId}
          </button>
        );
      })}
    </div>
  );
}
