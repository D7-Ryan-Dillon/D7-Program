"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small caption in the app's mono style. */
export const Cap = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("font-mono text-[10px] uppercase tracking-label text-muted-foreground", className)}>{children}</div>
);

/** A pill toggle. */
export function Chip({ active, onClick, children, title, disabled, className }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border-hair px-2.5 py-1 font-mono text-[10px] uppercase tracking-label transition-colors disabled:pointer-events-none disabled:opacity-40",
        active ? "border-magenta/50 bg-magenta/10 text-foreground" : "text-muted-foreground hover:border-white/25 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A number box that lets you type freely and commits valid numbers (clamped) as you go. */
export function Num({ label, value, onChange, min = -1e6, max = 1e6, step = 1, decimals = 1, className, suffix }: { label?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; decimals?: number; className?: string; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className={cn("flex items-center gap-1 text-[10px] text-muted-foreground", className)}>
      {label && <span className="shrink-0">{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? String(Number(value.toFixed(decimals)))}
        onFocus={(e) => {
          setDraft(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(Math.max(min, Math.min(max, value + (e.key === "ArrowUp" ? step : -step))));
          }
        }}
        className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums text-foreground outline-none focus-visible:border-ring"
      />
      {suffix && <span className="shrink-0">{suffix}</span>}
    </label>
  );
}

/** A thin 0-100 bar. */
export function Bar({ value, color = "#e8a6c8", className }: { value: number | null; color?: string; className?: string }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded bg-white/10", className)}>
      {value !== null && <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />}
    </div>
  );
}

export const scoreTone = (s: number | null) => (s === null ? "#8a8a8a" : s >= 90 ? "#e8a6c8" : s >= 60 ? "#db7228" : "#ff269e");
