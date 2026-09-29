"use client";

import { useProject } from "@/lib/project-store";
import { GlowPanel } from "@/components/shared/GlowPanel";

const DESCRIPTORS = [
  "Carved", "Stepped", "Porous", "Continuous", "Resistant", "Threaded",
  "Graduated", "Non-hierarchical Circulation", "Force-driven", "Light-filled",
  "Monumental", "Spatial Density",
];

export function AnalysisTab() {
  const { tiles, activeTileId } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];

  return (
    <div className="flex h-full items-center justify-center p-8">
      <GlowPanel className="w-full max-w-2xl" glow="orange">
        <div className="p-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-label text-orange">Coming next</div>
          <h2 className="mt-2 text-lg font-medium">12-descriptor scoring</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {activeTile ? `${activeTile.name} is loaded and ready.` : "Load a tile in the Viewer tab first."} This tab
            will score it -- qualitative and quantitative -- against all twelve studio descriptors.
          </p>
          <div className="mx-auto mt-6 grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
            {DESCRIPTORS.map((d) => (
              <div key={d} className="rounded-full border-hair px-3 py-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
        </div>
      </GlowPanel>
    </div>
  );
}
