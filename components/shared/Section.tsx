"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSectionOpen } from "@/lib/workspaceUi";

/**
 * One collapsible group of settings. The header (chevron + title, with an
 * optional `action` on the right such as an on/off switch or a Reset link) is
 * always visible; the body folds away. Open/closed is remembered per project
 * under `id`, so a long panel stays the way you left it.
 *
 * `variant="panel"` pads it to sit directly inside a GlowPanel; `"inline"` is
 * a group inside a longer panel, separated from the one above by a hairline.
 */
export function Section({
  id,
  title,
  defaultOpen = true,
  summary,
  action,
  variant = "panel",
  bodyClassName = "space-y-3",
  children,
}: {
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  /** Small muted text beside the title while shut ("3 plates", "On"...). */
  summary?: ReactNode;
  action?: ReactNode;
  variant?: "panel" | "inline";
  /** Spacing between the body's children (default `space-y-3`). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useSectionOpen(id, defaultOpen);
  return (
    <div className={cn(variant === "panel" ? "p-4" : "border-t border-border pt-3 first:border-t-0 first:pt-0")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="group/section flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] uppercase tracking-label text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="truncate">{title}</span>
          {!open && summary != null && <span className="truncate normal-case tracking-normal text-[10px] text-muted-foreground/70">· {summary}</span>}
        </button>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {open && <div className={cn("pt-3", bodyClassName)}>{children}</div>}
    </div>
  );
}
