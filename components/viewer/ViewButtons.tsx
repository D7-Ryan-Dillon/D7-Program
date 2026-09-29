"use client";

import { cn } from "@/lib/utils";
import { ALL_VIEWS } from "@/lib/faceViews";

export function ViewButtons({ active, onChange }: { active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_VIEWS.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={cn(
            "rounded-full border-hair px-3 py-1 font-mono text-[11px] tracking-label uppercase transition-colors",
            active === v.key
              ? "border-magenta/60 bg-magenta/15 text-foreground"
              : "border-border text-muted-foreground hover:border-white/25 hover:text-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
