"use client";

import { useEffect, useState } from "react";
import { renderTileThumbnail } from "@/lib/renderTile";
import { cn } from "@/lib/utils";

/** A small 3D preview of a tile, for identifying it by more than just its
 * name in a bank/list row -- same component everywhere (Viewer/Analysis's
 * switcher, Arrange's bank, Boards' tile picker and order list) so they all
 * render identically and share the one underlying render cache. */
export function TileThumbnail({ glbUrl, size = 24, className }: { glbUrl: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Rendered at 2x the display size for a crisp look on high-DPI screens.
    renderTileThumbnail(glbUrl, size * 2)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [glbUrl, size]);

  return (
    <span className={cn("inline-block shrink-0 overflow-hidden rounded bg-white/5", className)} style={{ width: size, height: size }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="h-full w-full object-contain" />
      )}
    </span>
  );
}
