"use client";

import { useState } from "react";
import { useProject } from "@/lib/project-store";
import { UploadZone } from "@/components/viewer/UploadZone";
import { TileSwitcher } from "@/components/shared/TileSwitcher";
import { ThreeViewport, type DisplayMode, type MeshColors, type MeshVisibility } from "@/components/viewer/ThreeViewport";
import { ViewButtons } from "@/components/viewer/ViewButtons";
import { DisplayModeBar } from "@/components/viewer/DisplayModeBar";
import { VisibilityPanel } from "@/components/viewer/VisibilityPanel";
import { MetricsPanel } from "@/components/viewer/MetricsPanel";
import { GlowPanel } from "@/components/shared/GlowPanel";

export function ViewerTab() {
  const { tiles, activeTileId } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];

  const [displayMode, setDisplayMode] = useState<DisplayMode>("rendered");
  const [activeView, setActiveView] = useState("perspective");
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: true });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });

  return (
    <div className="flex h-full flex-col gap-4">
      <TileSwitcher />

      {!activeTile ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <UploadZone />
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="flex min-h-[420px] flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ViewButtons active={activeView} onChange={setActiveView} />
              <DisplayModeBar mode={displayMode} onChange={setDisplayMode} />
            </div>
            <div className="min-h-0 flex-1">
              <ThreeViewport
                key={activeTile.id}
                tile={activeTile}
                displayMode={displayMode}
                visibility={visibility}
                colors={colors}
                activeViewKey={activeView}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <GlowPanel glow="orange">
              <div className="p-4">
                <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Visibility</div>
                <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
              </div>
            </GlowPanel>
            <GlowPanel className="flex-1" glow="magenta">
              <div className="p-4">
                <MetricsPanel tile={activeTile} />
              </div>
            </GlowPanel>
          </div>
        </div>
      )}
    </div>
  );
}
