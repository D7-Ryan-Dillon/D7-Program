"use client";

import { Loader2, RefreshCw, Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumberSlider } from "@/components/shared/NumberSlider";
import type { Priorities, ShapeKind } from "@/lib/arrange/types";
import { Cap, Chip, Num } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

/** The few kinds of building that work well. The other shapes still exist in older saved arrangements; they just are not offered. */
const KINDS: { key: ShapeKind; label: string; hint: string }[] = [
  { key: "compact", label: "Compact", hint: "pieces packed tightly into one mass" },
  { key: "spineV", label: "Tower", hint: "stacked pieces, a few beside" },
  { key: "slab", label: "Wide", hint: "wide layers stacked on each other" },
  { key: "courtyard", label: "Courtyard", hint: "a ring of pieces round an open middle" },
  { key: "stepped", label: "Terraced", hint: "terraces rising along one direction" },
];

/** Four sliders instead of eight: each one moves the settings that pull the same way, so each makes a clear difference. */
const FEELS: { label: string; hint: string; keys: (keyof Priorities)[] }[] = [
  { label: "Compact", hint: "a tight, knitted mass rather than a sprawl (also keeps pieces well supported)", keys: ["compactness", "structure"] },
  { label: "Tall", hint: "more floors, pieces stacked above each other", keys: ["vertical"] },
  { label: "Bright", hint: "more spaces open to the outside, more daylight", keys: ["daylight", "openness"] },
  { label: "Varied", hint: "use many different tiles instead of repeating a few", keys: ["variety"] },
  { label: "Interlocking", hint: "pieces that nest into each other's notches and steps, so shaped tiles fit together", keys: ["nesting"] },
];

export function GeneratePanel() {
  const A = useArrange();
  const { gen, priorities } = A.ui;
  const setGen = (patch: Partial<typeof gen>) => A.patchUi({ gen: { ...gen, ...patch } });
  const badCount = Object.values(A.doc.ratings).filter((r) => r === "bad").length;

  return (
    <div className="space-y-3">
      <Num label="Pieces" value={gen.amount} min={1} max={60} step={1} decimals={0} onChange={(v) => setGen({ amount: Math.round(v) })} />

      <div className="space-y-1.5">
        <Cap>Kind of building</Cap>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <Chip key={k.key} active={gen.shape === k.key} title={k.hint} onClick={() => setGen({ shape: k.key })}>
              {k.label}
            </Chip>
          ))}
        </div>
        {KINDS.find((k) => k.key === gen.shape) && <p className="text-[10px] text-muted-foreground">{KINDS.find((k) => k.key === gen.shape)!.hint}</p>}
      </div>

      <div className="space-y-2">
        <Cap>How it should feel</Cap>
        {FEELS.map((f) => (
          <div key={f.label} title={f.hint}>
            <NumberSlider
              label={f.label}
              value={priorities[f.keys[0]] ?? 50}
              min={0}
              max={100}
              step={5}
              onChange={(v) => A.patchUi({ priorities: { ...priorities, ...Object.fromEntries(f.keys.map((k, i) => [k, i === 0 ? v : Math.round(30 + v * 0.5)])) } as Priorities })}
            />
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">A connected route, good joints and your program rules are always on.</p>
      </div>

      <div className="space-y-2">
        <Button className="w-full" disabled={!!A.busy || !A.bank.length} onClick={A.generate}>
          {A.busy === "Generating" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Generate a new arrangement
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={!!A.busy || !A.bank.length} onClick={A.growMore} title="Add more pieces around everything already placed (locked pieces stay)">
            {A.busy === "Growing" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Grow more
          </Button>
          <Button variant="outline" size="sm" disabled={!!A.busy || badCount === 0} onClick={A.regenerate} title="Regrow only the parts past joints marked bad; locked pieces stay">
            {A.busy === "Regenerating" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Regenerate marked ({badCount})
          </Button>
        </div>
        {!A.bank.length && <p className="text-[11px] text-muted-foreground">Check the tiles it may use in the Bank first.</p>}
        {A.why && <p className="text-[11px] text-pink">{A.why}</p>}
        <p className="font-mono text-[10px] text-muted-foreground">{gen.seedLocked ? `seed ${gen.seed} (kept)` : `last seed ${gen.seed} · a new one each press`}</p>
        {A.notes.map((n, i) => (
          <p key={i} className="text-[11px] text-orange">
            {n}
          </p>
        ))}
      </div>

      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground">More options</summary>
        <div className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Seed" value={gen.seed} min={0} max={9_999_999} decimals={0} onChange={(v) => setGen({ seed: Math.round(v), seedLocked: true })} />
            <Num label="Min joint" value={gen.minScore} min={0} max={95} step={5} decimals={0} onChange={(v) => setGen({ minScore: Math.round(v) })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Keep this seed</Label>
              <p className="text-[10px] text-muted-foreground">Off: every Generate picks a new random seed. Typing a seed turns this on.</p>
            </div>
            <Switch checked={!!gen.seedLocked} onCheckedChange={(v) => setGen({ seedLocked: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Piece scale</Label>
              <p className="text-[10px] text-muted-foreground">Lets you scale pieces (breaks the 10 ft storeys)</p>
            </div>
            <Switch checked={A.ui.advanced} onCheckedChange={(v) => A.patchUi({ advanced: v })} />
          </div>
        </div>
      </details>
    </div>
  );
}
