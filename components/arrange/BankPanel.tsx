"use client";

import { useProject } from "@/lib/project-store";
import { cn } from "@/lib/utils";

export function BankPanel({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  const { tiles } = useProject();

  if (!tiles.length) {
    return <p className="text-xs text-muted-foreground">Load tiles in the Viewer tab first, then check the ones to include here.</p>;
  }

  return (
    <div className="space-y-1.5">
      {tiles.map((tile) => (
        <label
          key={tile.id}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-md border-hair px-2.5 py-1.5 text-xs transition-colors",
            selected.has(tile.id) ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25",
          )}
        >
          <input type="checkbox" className="accent-[var(--magenta)]" checked={selected.has(tile.id)} onChange={() => onToggle(tile.id)} />
          <span className="truncate">{tile.name}</span>
        </label>
      ))}
    </div>
  );
}
