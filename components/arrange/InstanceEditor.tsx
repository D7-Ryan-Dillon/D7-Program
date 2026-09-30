"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "@/lib/arrange/types";

const MIRROR_AXES: ("x" | "y" | "z")[] = ["x", "y", "z"];

function toggleMirror(mirror: string, axis: "x" | "y" | "z"): string {
  const set = new Set(mirror.toLowerCase().split("").filter(Boolean));
  if (set.has(axis)) set.delete(axis);
  else set.add(axis);
  return MIRROR_AXES.filter((a) => set.has(a)).join("");
}

export function InstanceEditor({
  instance,
  tile,
  onUpdate,
  onRemove,
  onSnap,
}: {
  instance: PlacedInstance | null;
  tile: ParsedTile | undefined;
  onUpdate: (id: string, patch: Partial<PlacedInstance>) => void;
  onRemove: (id: string) => void;
  onSnap: (id: string) => void;
}) {
  if (!instance) {
    return <p className="text-xs text-muted-foreground">Click a piece in the viewport (or the list below) to select and edit it.</p>;
  }

  const setPos = (axis: 0 | 1 | 2, value: number) => {
    const next = [...instance.posFt] as [number, number, number];
    next[axis] = value;
    onUpdate(instance.id, { posFt: next });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs" title={tile?.name}>
          {tile?.name ?? instance.tileId}
        </span>
        <button
          type="button"
          aria-label="Remove piece"
          onClick={() => onRemove(instance.id)}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          ×
        </button>
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Position (ft)</div>
        <div className="flex gap-2">
          {(["X", "Y", "Z"] as const).map((label, axis) => (
            <label key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {label}
              <Input
                type="number"
                className="h-7 w-16 px-1.5 text-[11px]"
                value={instance.posFt[axis]}
                onChange={(e) => setPos(axis as 0 | 1 | 2, Number(e.target.value) || 0)}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
        Scale
        <Input
          type="number"
          step={0.1}
          min={0.1}
          className="h-7 w-16 px-1.5 text-[11px]"
          value={instance.scale}
          onChange={(e) => onUpdate(instance.id, { scale: Math.max(0.1, Number(e.target.value) || 1) })}
        />
      </label>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Rotate 90° (Z)</div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => onUpdate(instance.id, { rotZ: ((instance.rotZ + 1) % 4) as 0 | 1 | 2 | 3 })}>
          {instance.rotZ * 90}°
        </Button>
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Mirror</div>
        <div className="flex gap-1.5">
          {MIRROR_AXES.map((axis) => {
            const active = instance.mirror.toLowerCase().includes(axis);
            return (
              <button
                key={axis}
                type="button"
                onClick={() => onUpdate(instance.id, { mirror: toggleMirror(instance.mirror, axis) })}
                className={cn(
                  "flex-1 rounded-md border-hair px-2 py-1.5 font-mono text-[10px] uppercase tracking-label transition-colors",
                  active ? "border-magenta/60 bg-magenta/15 text-foreground" : "text-muted-foreground hover:border-white/25 hover:text-foreground",
                )}
              >
                {axis.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={() => onSnap(instance.id)}>
        Snap to nearest
      </Button>
    </div>
  );
}
