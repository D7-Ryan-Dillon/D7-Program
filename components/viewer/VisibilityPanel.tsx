"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";

const SWATCHES = ["#e8a6c8", "#c43383", "#db7228", "#f2b878", "#9aa0a6", "#e6e6e6", "#1c1c1f"];

function Row({
  label,
  visible,
  onToggleVisible,
  color,
  onColor,
}: {
  label: string;
  visible: boolean;
  onToggleVisible: (v: boolean) => void;
  color: string;
  onColor: (c: string) => void;
}) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">{label}</span>
        <Switch checked={visible} onCheckedChange={onToggleVisible} />
      </div>
      <div className="flex gap-1.5">
        {SWATCHES.map((s) => (
          <button
            key={s}
            aria-label={`${label} color ${s}`}
            onClick={() => onColor(s)}
            className={cn(
              "h-4 w-4 rounded-full border transition-transform hover:scale-110",
              color === s ? "border-white/80 ring-1 ring-white/40" : "border-white/20",
            )}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>
    </div>
  );
}

export function VisibilityPanel({
  visibility,
  onVisibility,
  colors,
  onColors,
}: {
  visibility: MeshVisibility;
  onVisibility: (v: MeshVisibility) => void;
  colors: MeshColors;
  onColors: (c: MeshColors) => void;
}) {
  return (
    <div className="divide-y divide-border">
      <Row
        label="Foam"
        visible={visibility.foam}
        onToggleVisible={(v) => onVisibility({ ...visibility, foam: v })}
        color={colors.foam}
        onColor={(c) => onColors({ ...colors, foam: c })}
      />
      <Row
        label="Void"
        visible={visibility.void}
        onToggleVisible={(v) => onVisibility({ ...visibility, void: v })}
        color={colors.void}
        onColor={(c) => onColors({ ...colors, void: c })}
      />
    </div>
  );
}
