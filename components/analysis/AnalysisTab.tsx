"use client";

import { useMemo } from "react";
import { useProject } from "@/lib/project-store";
import { TileSwitcher } from "@/components/shared/TileSwitcher";
import { UploadZone } from "@/components/viewer/UploadZone";
import { DescriptorCard } from "@/components/analysis/DescriptorCard";
import { scoreTile } from "@/lib/scoring/descriptors";

export function AnalysisTab() {
  const { tiles, activeTileId } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];
  const results = useMemo(() => (activeTile ? scoreTile(activeTile) : []), [activeTile]);

  if (!activeTile) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-xl">
          <UploadZone />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <TileSwitcher />
      <div>
        <div className="text-base font-medium">{activeTile.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          scored against all twelve studio descriptors · id {activeTile.id}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((r) => (
          <DescriptorCard key={r.key} result={r} />
        ))}
      </div>
    </div>
  );
}
