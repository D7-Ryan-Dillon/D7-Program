"use client";

import { FlipHorizontal2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "@/components/boards/ColorField";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { cn } from "@/lib/utils";
import { defaultCutFaceSettings, type ClipAxis, type ClipState } from "@/lib/clipping";

const AXES: ClipAxis[] = ["x", "y", "z"];

/** The clipping-plane control shared by the Viewer tab, the Sections
 * cube/hex builder, and the Boards tab's per-tile popup editor. The plane
 * itself is never drawn -- toggling it on reveals the model's own interior
 * (every mesh here is double-sided already) plus a thin cut-boundary
 * outline; the optional "cut face" sub-panel adds a flat colored fill at
 * the cut, with independent color/opacity for foam and void. */
export function ClippingPlaneControl({ value, onChange }: { value: ClipState; onChange: (next: ClipState) => void }) {
  const cutFace = value.cutFace ?? defaultCutFaceSettings();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Clipping plane</span>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ ...value, enabled })} />
      </div>

      {value.enabled && (
        <>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex flex-1 rounded-full border-hair p-0.5">
              {AXES.map((axis) => (
                <button
                  key={axis}
                  onClick={() => onChange({ ...value, axis })}
                  className={cn(
                    "flex-1 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition-colors",
                    value.axis === axis ? "bg-gradient-to-r from-magenta to-orange text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {axis}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant={value.reversed ? "default" : "outline"}
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Reverse clip direction"
              title="Reverse which side gets cut away"
              onClick={() => onChange({ ...value, reversed: !value.reversed })}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <label className="block text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted-foreground">Position</span>
              <span className="font-mono tabular-nums">{Math.round(value.position * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(value.position * 100)}
              onChange={(e) => onChange({ ...value, position: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </label>

          <div className="space-y-2 rounded-md border border-dashed border-border p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Cut face highlight</span>
              <Switch checked={cutFace.enabled} onCheckedChange={(enabled) => onChange({ ...value, cutFace: { ...cutFace, enabled } })} />
            </div>
            {cutFace.enabled && (
              <>
                <ColorField label="Foam" value={cutFace.foamColor} onChange={(foamColor) => onChange({ ...value, cutFace: { ...cutFace, foamColor } })} />
                <NumberSlider
                  label="Foam opacity"
                  value={Math.round(cutFace.foamOpacity * 100)}
                  min={10}
                  max={100}
                  suffix="%"
                  onChange={(v) => onChange({ ...value, cutFace: { ...cutFace, foamOpacity: v / 100 } })}
                />
                <ColorField label="Void" value={cutFace.voidColor} onChange={(voidColor) => onChange({ ...value, cutFace: { ...cutFace, voidColor } })} />
                <NumberSlider
                  label="Void opacity"
                  value={Math.round(cutFace.voidOpacity * 100)}
                  min={10}
                  max={100}
                  suffix="%"
                  onChange={(v) => onChange({ ...value, cutFace: { ...cutFace, voidOpacity: v / 100 } })}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
