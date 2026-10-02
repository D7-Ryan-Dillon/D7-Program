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
import { ExportPanel } from "@/components/viewer/ExportPanel";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { SquareFrame } from "@/components/shared/SquareFrame";
import { Separator } from "@/components/ui/separator";
import { ClippingPlaneControl } from "@/components/shared/ClippingPlaneControl";
import { defaultClipState, type ClipState } from "@/lib/clipping";

export function ViewerTab() {
  const { tiles, activeTileId } = useProject();
  const activeTile = tiles.find((t) => t.id === activeTileId) ?? tiles[0];

  const [displayMode, setDisplayMode] = useState<DisplayMode>("rendered");
  const [activeView, setActiveView] = useState("perspective");
  const [visibility, setVisibility] = useState<MeshVisibility>({ foam: true, void: true });
  const [colors, setColors] = useState<MeshColors>({ foam: "#e8a6c8", void: "#1c1c1f" });
  const [clip, setClip] = useState<ClipState>(defaultClipState());

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <TileSwitcher />

      {!activeTile ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <UploadZone />
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_280px] grid-rows-[minmax(0,1fr)] gap-4">
          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
            <GlowPanel glow="orange">
              <div className="p-4">
                <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Camera</div>
                <ViewButtons active={activeView} onChange={setActiveView} />
                <Separator className="my-3" />
                <DisplayModeBar mode={displayMode} onChange={setDisplayMode} />
              </div>
            </GlowPanel>
            <GlowPanel glow="magenta">
              <div className="p-4">
                <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Visibility</div>
                <VisibilityPanel visibility={visibility} onVisibility={setVisibility} colors={colors} onColors={setColors} />
              </div>
            </GlowPanel>
            <GlowPanel glow="orange">
              <div className="p-4">
                <ClippingPlaneControl value={clip} onChange={setClip} />
              </div>
            </GlowPanel>
          </div>

          <div className="min-h-0 min-w-0">
            <SquareFrame className="relative">
              <ThreeViewport
                key={activeTile.id}
                tile={activeTile}
                displayMode={displayMode}
                visibility={visibility}
                colors={colors}
                clip={clip}
                activeViewKey={activeView}
              />
            </SquareFrame>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
            <GlowPanel className="flex-1" glow="magenta">
              <div className="p-4">
                <MetricsPanel tile={activeTile} />
                <Separator className="my-4" />
                <div className="mb-2 font-mono text-[11px] tracking-label uppercase text-muted-foreground">Export</div>
                <ExportPanel tile={activeTile} visibility={visibility} />
              </div>
            </GlowPanel>
          </div>
        </div>
      )}
    </div>
  );
}
