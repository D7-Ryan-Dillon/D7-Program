"use client";

import type { ComponentType, ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

/** One small icon button on a viewport's strip that opens a popup for ONE
 * setting (view, display, visibility, clipping, rotation...). Keeping each
 * setting behind its own button is what lets a viewport carry a lot of
 * settings without crowding the viewport itself. */
export function PaneMenu({
  icon: Icon,
  label,
  title,
  active = false,
  showLabel = false,
  onApplyAll,
  side = "top",
  width = "w-64",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  /** Highlights the button when its setting is "on" / non-default. */
  active?: boolean;
  showLabel?: boolean;
  /** Adds an "Apply to all viewports" link at the bottom of the popup. */
  onApplyAll?: () => void;
  /** Which way the popup opens from its button (a toolbar at the top of a panel wants "bottom"). */
  side?: "top" | "bottom";
  width?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        title={title ?? label}
        className={cn(
          "flex h-7 items-center gap-1 rounded-md border-hair px-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground data-[popup-open]:border-magenta/50 data-[popup-open]:bg-magenta/10 data-[popup-open]:text-foreground",
          active && "border-magenta/40 text-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {showLabel && <span>{label}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={side} align="center" sideOffset={6} collisionPadding={8} className="z-[70]">
          <Popover.Popup className={cn("max-h-[70vh] max-w-[92vw] space-y-3 overflow-y-auto rounded-lg border-hair bg-popover p-3 text-xs text-popover-foreground shadow-lg outline-none", width)}>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">{label}</div>
            {children}
            {onApplyAll && (
              <button type="button" onClick={onApplyAll} className="w-full border-t border-border pt-2 text-left text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Apply to all viewports
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
