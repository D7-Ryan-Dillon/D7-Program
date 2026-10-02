"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";

/** A number box you can type into: keeps a local draft while it's focused so
 * a half-typed value like "0." or "0.2" isn't rewritten under your cursor,
 * and pushes every valid number up as you type (clamped, rounded to
 * `decimals`). */
function ExactField({ value, min, max, decimals, suffix, onCommit }: { value: number; min: number; max: number; decimals: number; suffix: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const round = (v: number) => {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
  };
  return (
    <span className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? value.toFixed(decimals)}
        onFocus={(e) => {
          setDraft(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onCommit(Math.max(min, Math.min(max, round(v))));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label="Exact value"
        className="h-6 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums outline-none focus-visible:border-ring"
      />
      {suffix && <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>}
    </span>
  );
}

/** A labeled slider with a live numeric readout -- extracted from
 * BoardSettingsPanel.tsx so Boards and the Sections per-face panel (and
 * anywhere else that wants a plain 0..100-style slider) share one control.
 * With `exact`, the readout becomes a box you can also type a precise value
 * into (used for line weights, where you want 0.25 pt, not "about a
 * quarter"). */
export function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  decimals = 0,
  exact = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  exact?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        {exact ? (
          <ExactField value={value} min={min} max={max} decimals={decimals} suffix={suffix} onCommit={onChange} />
        ) : (
          <span className="font-mono tabular-nums">
            {value.toFixed(decimals)}
            {suffix}
          </span>
        )}
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} />
    </label>
  );
}
