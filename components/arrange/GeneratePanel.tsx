"use client";

import { Loader2, RefreshCw, Sparkles, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { normalizePriorities, PRIORITY_LABELS, SHAPES } from "@/lib/arrange/types";
import { Cap, Chip, Num } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

/** One line of "asked, got" for the result. */
function Row({ label, asked, got }: { label: string; asked?: string; got: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        {asked ? <span className="text-muted-foreground">{asked} → </span> : null}
        {got}
      </span>
    </div>
  );
}

export function GeneratePanel() {
  const A = useArrange();
  const { gen } = A.ui;
  const priorities = normalizePriorities(A.ui.priorities);
  const setGen = (patch: Partial<typeof gen>) => A.patchUi({ gen: { ...gen, ...patch } });
  const badCount = Object.values(A.doc.ratings).filter((r) => r === "bad").length;
  const working = A.busy === "Generating" || A.busy === "Growing" || A.busy === "Regenerating";
  const p = A.progress;
  const shape = SHAPES.find((k) => k.key === gen.shape);
  const rep = A.report;

  return (
    <div className="space-y-3">
      <Num label="Pieces" value={gen.amount} min={1} max={60} step={1} decimals={0} onChange={(v) => setGen({ amount: Math.round(v) })} />

      <div className="space-y-1.5">
        <Cap>Kind of building</Cap>
        <div className="flex flex-wrap gap-1">
          {SHAPES.map((k) => (
            <Chip key={k.key} active={gen.shape === k.key} title={k.hint} onClick={() => setGen({ shape: k.key })}>
              {k.label}
            </Chip>
          ))}
        </div>
        {shape && <p className="text-[10px] text-muted-foreground">{shape.hint}</p>}
        <div className="flex items-center justify-between pt-1">
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Branching wings</Label>
            <p className="text-[10px] text-muted-foreground">Off: the whole building is the shape, uniform. On: the last third grows out as wings.</p>
          </div>
          <Switch checked={!!gen.branching} onCheckedChange={(v) => setGen({ branching: v })} />
        </div>
      </div>

      <div className="space-y-2">
        <Cap>How it should feel</Cap>
        {PRIORITY_LABELS.map((f) => (
          <div key={f.key} title={f.hint}>
            <NumberSlider label={f.label} value={priorities[f.key]} min={0} max={100} step={5} onChange={(v) => A.patchUi({ priorities: { ...priorities, [f.key]: v } })} />
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">Always on: floors meet floors, no dead-end stair, every floor plate reachable from another, one way in on the ground, your program rules.</p>
      </div>

      <div className="space-y-2">
        {working ? (
          <div className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex items-center gap-2 text-[11px]">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{p?.message ?? `${A.busy}…`}</span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-pink transition-all" style={{ width: `${p ? Math.round((100 * p.placed) / Math.max(1, p.total)) : 4}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">There is no time limit: it runs until the building is made. The first run works out how the tiles fit together and is the slowest.</p>
            <Button variant="outline" size="sm" className="w-full" onClick={A.stopGen}>
              <Square className="mr-1.5 h-3 w-3" />
              Stop
            </Button>
          </div>
        ) : (
          <Button className="w-full" disabled={!A.bank.length} onClick={A.generate}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Generate a new arrangement
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={!!A.busy || !A.bank.length} onClick={A.growMore} title="Add more pieces around everything already placed (locked pieces stay)">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Grow more
          </Button>
          <Button variant="outline" size="sm" disabled={!!A.busy || badCount === 0} onClick={A.regenerate} title="Regrow only the parts past joints marked bad; locked pieces stay">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate marked ({badCount})
          </Button>
        </div>
        {!A.bank.length && <p className="text-[11px] text-muted-foreground">Check the tiles it may use in the Bank first.</p>}
        {A.why && <p className="text-[11px] text-pink">{A.why}</p>}
        {rep && (
          <div className="space-y-0.5 rounded-md border border-border p-2 text-[11px]">
            <Row label="Pieces" asked={String(rep.asked.pieces)} got={String(rep.got.pieces)} />
            <Row label="Levels" got={`${rep.got.levels} (${rep.got.heightFt.toFixed(0)} ft tall)`} />
            <Row label="Footprint" got={`${rep.got.widthFt.toFixed(0)} × ${rep.got.depthFt.toFixed(0)} ft`} />
            <Row label="Stacked above another" got={String(rep.got.stackedPairs)} />
            <Row label="Different tiles" asked={`up to ${Math.max(1, Math.round(1 + (rep.asked.varied / 100) * (rep.asked.pieces - 1)))}`} got={String(rep.got.distinctTiles)} />
            <Row label="Climbing tiles (stair or ramp)" got={String(rep.got.climbingTiles)} />
            <Row label="Search" got={`${rep.attempts} plan${rep.attempts === 1 ? "" : "s"} tried`} />
          </div>
        )}
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
