"use client";

import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type GlowPanelProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  glow?: "magenta" | "orange" | "mixed";
};

const GLOW_COLOR: Record<NonNullable<GlowPanelProps["glow"]>, string> = {
  magenta: "196,51,131",
  orange: "219,114,40",
  mixed: "196,51,131",
};

/**
 * Glass panel with an Aceternity-style spotlight border: a radial gradient
 * that follows the pointer, visible only along the 1px edge.
 */
export function GlowPanel({ children, className, innerClassName, glow = "magenta" }: GlowPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [active, setActive] = useState(false);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      className={cn("group relative rounded-xl p-px", className)}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-300"
        style={{
          opacity: active ? 1 : 0,
          background: `radial-gradient(360px circle at ${pos.x}px ${pos.y}px, rgba(${GLOW_COLOR[glow]},0.55), transparent 45%)`,
        }}
      />
      <div className={cn("glass-panel relative h-full w-full rounded-[calc(0.75rem-1px)]", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
