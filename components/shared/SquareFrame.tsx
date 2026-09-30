"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Centers its children in a box that's always square, sized to the largest
 * square that fits the available space (bounded by whichever of width/height
 * is smaller) -- CSS aspect-ratio alone can't do this because it can't see
 * both constraints at once, so this tracks the parent's size directly.
 */
export function SquareFrame({ children, className }: { children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(Math.max(0, Math.min(width, height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="flex h-full w-full min-h-0 min-w-0 items-center justify-center">
      <div className={className} style={{ width: size || "100%", height: size || "100%" }}>
        {children}
      </div>
    </div>
  );
}
