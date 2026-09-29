"use client";

import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";

export function ArrangeTab() {
  const { tiles } = useProject();

  return (
    <div className="flex h-full items-center justify-center p-8">
      <GlowPanel className="w-full max-w-2xl" glow="magenta">
        <div className="p-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-label text-magenta">Coming next</div>
          <h2 className="mt-2 text-lg font-medium">Automated assembly</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {tiles.length > 0
              ? `${tiles.length} tile${tiles.length === 1 ? "" : "s"} in the bank.`
              : "Load tiles in the Viewer tab to start building a bank."}{" "}
            This tab will grow a connected composition out of them, score every joint, and export the result.
          </p>
        </div>
      </GlowPanel>
    </div>
  );
}
