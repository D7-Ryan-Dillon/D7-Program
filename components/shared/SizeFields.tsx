"use client";

import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SizePreset {
  w: number;
  h: number;
  label?: string;
}

/** Common picture and video sizes. */
export const SIZE_PRESETS: SizePreset[] = [
  { w: 1280, h: 720, label: "HD 1280 × 720" },
  { w: 1920, h: 1080, label: "Full HD 1920 × 1080" },
  { w: 2560, h: 1440, label: "QHD 2560 × 1440" },
  { w: 3840, h: 2160, label: "4K 3840 × 2160" },
  { w: 1080, h: 1080, label: "Square 1080 × 1080" },
  { w: 2000, h: 2000, label: "Square 2000 × 2000" },
  { w: 1080, h: 1920, label: "Vertical 1080 × 1920" },
  { w: 2400, h: 1600, label: "Photo 3:2 2400 × 1600" },
];

/**
 * Width and height in pixels, typed freely, with a link that keeps the shape while one of them changes and a menu of common sizes.
 * Used by every export that makes a picture or a film, so each can be set to exactly the size wanted.
 */
export function SizeFields({ width, height, onChange, presets = SIZE_PRESETS, min = 64, max = 10000, className }: { width: number; height: number; onChange: (w: number, h: number) => void; presets?: SizePreset[]; min?: number; max?: number; className?: string }) {
  const [linked, setLinked] = useState(true);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const even = (v: number) => Math.round(v / 2) * 2; // video codecs need even sizes
  const setW = (v: number) => {
    const w = clamp(v);
    onChange(w, linked ? clamp((w * height) / Math.max(1, width)) : height);
  };
  const setH = (v: number) => {
    const h = clamp(v);
    onChange(linked ? clamp((h * width) / Math.max(1, height)) : width, h);
  };
  const match = presets.find((p) => p.w === width && p.h === height);
  const field = (label: string, value: number, set: (v: number) => void) => (
    <label className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={2}
        value={value}
        onChange={(e) => Number(e.target.value) > 0 && set(Number(e.target.value))}
        onBlur={(e) => set(even(Number(e.target.value) || value))}
        className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums text-foreground outline-none focus-visible:border-ring"
        aria-label={label === "W" ? "Width in pixels" : "Height in pixels"}
      />
    </label>
  );
  return (
    <div className={cn("space-y-1.5", className)}>
      <Select className="h-7 text-[11px]" value={match ? `${match.w}x${match.h}` : "custom"} onChange={(e) => {
        const p = presets.find((x) => `${x.w}x${x.h}` === e.target.value);
        if (p) onChange(p.w, p.h);
      }} aria-label="Common sizes">
        <option value="custom">Custom size</option>
        {presets.map((p) => (
          <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
            {p.label ?? `${p.w} × ${p.h}`}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1.5">
        {field("W", width, setW)}
        <button type="button" onClick={() => setLinked(!linked)} aria-label={linked ? "Width and height are linked" : "Width and height are free"} title={linked ? "Linked: the shape stays" : "Free: set each on its own"} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-hair text-muted-foreground hover:text-foreground", linked && "border-magenta/50 text-foreground")}>
          {linked ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
        </button>
        {field("H", height, setH)}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">px</span>
      </div>
    </div>
  );
}
