"use client";

// The colours of reports, drawing boards and drawing exports, remembered with the project and editable before an export anywhere in
// the program. Two starting points: the app's own look (black, pink, orange) and white paper for printing.

import { groundFor, type DrawingStyle } from "@/lib/drawing/render";
import { useProjectUi } from "@/lib/project-store";

export interface Palette {
  /** page */
  bg: string;
  text: string;
  muted: string;
  /** the title and the level lines */
  accent: string;
  /** section headings, routes */
  heading: string;
  /** solid foam in plans and sections */
  foam: string;
  plate: string;
  branch: string;
  /** the tint of a floor in plan */
  tint: string;
  /** good, at risk, broken */
  good: string;
  warn: string;
  bad: string;
  /** frames and rules */
  frame: string;
}

export const PALETTES: Record<"dark" | "paper", Palette> = {
  dark: { bg: "#000000", text: "#ececec", muted: "#8a8a8a", accent: "#c43383", heading: "#db7228", foam: "#e8a6c8", plate: "#f2b878", branch: "#db7228", tint: "#262626", good: "#e8a6c8", warn: "#db7228", bad: "#ff269e", frame: "#4d4d4d" },
  paper: { bg: "#ffffff", text: "#111111", muted: "#666666", accent: "#c43383", heading: "#c25a14", foam: "#1b1b1b", plate: "#8a8a8a", branch: "#c25a14", tint: "#dcdcdc", good: "#c43383", warn: "#c25a14", bad: "#d4145a", frame: "#000000" },
};

export const defaultPalette = (): Palette => ({ ...PALETTES.dark });

const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(196,51,131,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The same colours as a drawing style (plans and sections). */
export function paletteStyle(p: Palette): DrawingStyle {
  return { ground: groundFor(p.bg), bg: p.bg, foam: p.foam, plate: p.plate, branch: p.branch, tint: p.tint, text: p.text, muted: p.muted, frame: p.frame, accent: p.accent, emphasis: rgba(p.accent, 0.4), route: p.heading };
}

/** The project's palette and a way to change it. */
export function usePalette(): [Palette, (patch: Partial<Palette>) => void, (preset: "dark" | "paper") => void] {
  const [palette, setUi] = useProjectUi<Palette>("palette", defaultPalette);
  const merged = { ...defaultPalette(), ...palette };
  return [merged, (patch) => setUi((prev) => ({ ...defaultPalette(), ...prev, ...patch })), (preset) => setUi(() => ({ ...PALETTES[preset] }))];
}
