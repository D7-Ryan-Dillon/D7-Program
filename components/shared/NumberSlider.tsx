"use client";

import { Slider } from "@/components/ui/slider";

/** A labeled slider with a live numeric readout -- extracted from
 * BoardSettingsPanel.tsx so Boards and the Sections per-face panel (and
 * anywhere else that wants a plain 0..100-style slider) share one control. */
export function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  decimals = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} />
    </label>
  );
}
