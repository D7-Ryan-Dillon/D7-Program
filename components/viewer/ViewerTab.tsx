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
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <TileSwitcher />

      {!activeTile ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <UploadZone />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)]">
          <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
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

          <div className="order-1 min-w-0 lg:order-none lg:min-h-0">
            <div className="h-[min(100vw,70vh)] lg:h-full">
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
          </div>

          <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:overflow-y-auto">
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
