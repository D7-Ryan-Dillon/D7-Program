"use client";

import { useProject } from "@/lib/project-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function BankPanel({
  selected,
  onToggle,
  onSelectAll,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
}) {
  const { tiles } = useProject();

  if (!tiles.length) {
    return <p className="text-xs text-muted-foreground">Load tiles in the Viewer tab first, then check the ones to include here.</p>;
  }

  const allSelected = tiles.length > 0 && tiles.every((t) => selected.has(t.id));

  return (
    <div className="space-y-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="mb-1 h-6 w-full justify-start px-1 text-[11px] tracking-label uppercase text-muted-foreground"
        onClick={() => onSelectAll(allSelected ? [] : tiles.map((t) => t.id))}
      >
        {allSelected ? "Deselect all" : "Select all"}
      </Button>
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
