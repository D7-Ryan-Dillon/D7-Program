"use client";

import { Loader2 } from "lucide-react";

/** Covers a panel while something is being made, so a half-built or stale result is never shown. Put it inside a `relative` box. */
export function LoadingCover({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-lg bg-black">
      <Loader2 className="h-6 w-6 animate-spin text-pink" />
      <span className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">{label}</span>
    </div>
  );
}
