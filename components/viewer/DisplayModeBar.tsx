"use client";

import { cn } from "@/lib/utils";
import type { DisplayMode } from "@/components/viewer/ThreeViewport";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "rendered", label: "Rendered" },
  { key: "ghosted", label: "Ghosted" },
];

export function DisplayModeBar({ mode, onChange }: { mode: DisplayMode; onChange: (mode: DisplayMode) => void }) {
  return (
    <div className="inline-flex rounded-full border-hair p-0.5">
      {MODES.map((m) => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          className={cn(
            "rounded-full px-3 py-1 font-mono text-[11px] tracking-label uppercase transition-colors",
            mode === m.key ? "bg-gradient-to-r from-magenta to-orange text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
