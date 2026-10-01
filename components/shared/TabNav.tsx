"use client";

import { cn } from "@/lib/utils";

export type WorkspaceTabKey = "viewer" | "analysis" | "arrange" | "sections" | "boards";

const TABS: { key: WorkspaceTabKey; label: string }[] = [
  { key: "viewer", label: "01 Viewer" },
  { key: "sections", label: "02 Sections" },
  { key: "analysis", label: "03 Analysis" },
  { key: "arrange", label: "04 Arrange" },
  { key: "boards", label: "05 Boards" },
];

export function TabNav({ active, onChange }: { active: WorkspaceTabKey; onChange: (key: WorkspaceTabKey) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-full border-hair bg-surface/60 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "rounded-full px-4 py-1.5 font-mono text-[11px] tracking-label uppercase transition-colors",
            active === tab.key
              ? "bg-gradient-to-r from-magenta to-orange text-white shadow-[0_0_16px_-4px_rgba(196,51,131,0.6)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
