"use client";

import { Check, Eye, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { cn } from "@/lib/utils";
import { Cap } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

/** Smooth and seal: bridges openings and floors that miss by a little, and lists the floating fragments it finds for you to approve (nothing is removed until you do). */
export function SmoothPanel() {
  const A = useArrange();
  const sm = A.ui.smooth;
  const set = (patch: Partial<typeof sm>) => A.patchUi({ smooth: { ...sm, ...patch } });
  const report = A.whole.smooth;
  const list = report?.floaters ?? [];
  const approved = new Set(sm.approved);
  const toggle = (key: string) => set({ approved: approved.has(key) ? sm.approved.filter((k) => k !== key) : [...sm.approved, key], rejected: sm.rejected.filter((k) => k !== key) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Smooth &amp; seal</Label>
          <p className="text-[10px] text-muted-foreground">One smooth model; the pieces are shown fused</p>
        </div>
        <Switch checked={A.ui.smoothOn} disabled={!A.layout.boxes.length} onCheckedChange={(v) => A.patchUi({ smoothOn: v })} />
      </div>
      <NumberSlider label="Bridge gaps up to" value={sm.toleranceFt} min={0.5} max={3} step={0.5} decimals={1} suffix=" ft" onChange={(v) => set({ toleranceFt: v })} />
      <NumberSlider label="List fragments and pockets smaller than (0 = every one)" value={sm.minFoamFt3} min={0} max={500} step={10} suffix=" ft³" onChange={(v) => set({ minFoamFt3: v, minVoidFt3: Math.min(v / 5, 100) })} />

      {report && (
        <div className="space-y-1 rounded-md border-hair p-2 text-[11px] text-muted-foreground">
          <div>
            {A.ui.smoothOn ? "Applied: " : "Would apply: "}
            {report.bridged ? `${report.bridged} cells bridged` : "no gaps to bridge"}
            {report.floorsRaised ? `, ${report.floorsRaised} floor cells brought level` : ""}
          </div>
          <div>
            {list.length} fragment{list.length === 1 ? "" : "s"} found{approved.size ? `, ${[...approved].filter((k) => list.some((f) => f.key === k)).length} approved` : ""}
            {A.ui.smoothOn && (report.removed || report.filled) ? ` · ${report.removed} removed, ${report.filled} filled` : ""}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Cap>Fragments to approve</Cap>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => set({ approved: list.map((f) => f.key), rejected: [] })}>
                Approve all
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => set({ approved: [] })}>
                <Undo2 className="mr-1 h-3 w-3" />
                None
              </Button>
            </div>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {list.map((f) => {
              const on = approved.has(f.key);
              return (
                <div key={f.key} className={cn("flex items-center gap-2 rounded-md border-hair px-2 py-1.5 text-[11px]", on && "border-magenta/50 bg-magenta/10")}>
                  <button type="button" aria-label="Look at it" title="Light it up" onClick={() => A.setEvidenceKey("floaters")} className="text-muted-foreground hover:text-foreground">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{f.kind === "foam" ? "Floating foam" : "Sealed pocket"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {f.volumeFt3.toFixed(1)} ft³ · at {f.centroid.map((v) => v.toFixed(0)).join(", ")} ft
                    </div>
                  </div>
                  <Button size="sm" variant={on ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => toggle(f.key)}>
                    {on ? (
                      <>
                        <Check className="mr-1 h-3 w-3" />
                        {f.kind === "foam" ? "Remove" : "Fill"}
                      </>
                    ) : f.kind === "foam" ? (
                      "Keep"
                    ) : (
                      "Keep"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Nothing is removed unless it is approved here and Smooth &amp; seal is on. A whole piece can never be cut off this way: those are errors in the Warnings.</p>
        </div>
      )}
    </div>
  );
}
