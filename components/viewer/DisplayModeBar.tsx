"use client";

import { cn } from "@/lib/utils";
import type { DisplayMode } from "@/components/viewer/ThreeViewport";

const DEFAULT_MODES: { key: DisplayMode; label: string }[] = [
  { key: "rendered", label: "Rendered" },
  { key: "ghosted", label: "Ghosted" },
];

/** A pill toggle between display modes. Defaults to the Viewer tab's own
 * Rendered/Ghosted pair; the Sections cube/hex builder passes a third
 * "Faces" entry (its own display-mode union, unrelated to Viewer's) since
 * only there do tiles have discrete per-face input assignments to
 * visualize -- a real Grasshopper-exported tile has nothing a "Faces" mode
 * would mean. */
export function DisplayModeBar<T extends string>({ mode, onChange, modes }: { mode: T; onChange: (mode: T) => void; modes?: { key: T; label: string }[] }) {
  const list = modes ?? (DEFAULT_MODES as unknown as { key: T; label: string }[]);
  return (
    <div className="inline-flex rounded-full border-hair p-0.5">
      {list.map((m) => (
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
