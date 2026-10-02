"use client";

import type { MutableRefObject } from "react";
import { RotateCw } from "lucide-react";
import { ViewportExportButton } from "@/components/shared/ViewportExport";
import { PaneMenu } from "@/components/shared/PaneMenu";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { Switch } from "@/components/ui/switch";
import type { ViewportHandle } from "@/lib/viewportCapture";

/** The strip under viewports that aren't a plain tile viewer (Arrange, the
 * cube builder): auto-rotate (button + popup with a speed slider) and Export
 * (current view as PNG, or a turntable GIF / MP4). Sits BELOW the viewport,
 * never over it. */
export function ViewportTools({
  handleRef,
  name,
  autoRotate,
  onAutoRotate,
  rotateSecs,
  onRotateSecs,
}: {
  handleRef: MutableRefObject<ViewportHandle | null>;
  name: string;
  autoRotate: boolean;
  onAutoRotate: (on: boolean) => void;
  rotateSecs: number;
  onRotateSecs: (secs: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1.5">
      <PaneMenu icon={RotateCw} label="Rotate" showLabel active={autoRotate}>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Auto-rotate</span>
          <Switch checked={autoRotate} onCheckedChange={onAutoRotate} />
        </div>
        <NumberSlider label="Seconds per turn" value={rotateSecs} min={4} max={60} suffix=" s" onChange={onRotateSecs} />
        <p className="text-[10px] text-muted-foreground">Drag the model any time to take over.</p>
      </PaneMenu>
      <ViewportExportButton handleRef={handleRef} name={name} className="h-7 gap-1 px-1.5 text-[10px]" />
    </div>
  );
}
