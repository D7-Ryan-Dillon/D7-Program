"use client";

import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/boards/ColorField";
import { PALETTES, usePalette, type Palette } from "@/lib/boardPalette";

const FIELDS: [keyof Palette, string][] = [
  ["bg", "Background"],
  ["text", "Text"],
  ["accent", "Title and level lines"],
  ["heading", "Headings"],
  ["foam", "Sections (solid)"],
  ["plate", "Floor plates"],
  ["branch", "Branches"],
  ["tint", "Floor tint in plans"],
];

/** The colours of reports and drawings, saved with the project. Two starting points, then each colour on its own. */
export function PaletteEditor() {
  const [palette, set, preset] = usePalette();
  const is = (p: "dark" | "paper") => (Object.keys(PALETTES[p]) as (keyof Palette)[]).every((k) => PALETTES[p][k] === palette[k]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Button type="button" size="sm" variant={is("dark") ? "default" : "outline"} className="h-7" onClick={() => preset("dark")}>
          App look (dark)
        </Button>
        <Button type="button" size="sm" variant={is("paper") ? "default" : "outline"} className="h-7" onClick={() => preset("paper")}>
          White paper
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <ColorField key={k} label={label} value={palette[k]} onChange={(v) => set({ [k]: v })} />
        ))}
      </div>
    </div>
  );
}
