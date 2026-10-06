"use client";

import { RotateCcw } from "lucide-react";
import { useWalkRules } from "@/lib/useWalkRules";
import { WALK_FIELDS } from "@/lib/walking";

/**
 * The walking rules, in one place, wherever they are edited. They are the project's, not this tab's: Arrange's joints and reachability and Analysis's
 * routes and usable-space check all read the same four numbers, and changing one recomputes both.
 */
export function WalkRulesEditor() {
  const w = useWalkRules();
  const changed = Object.keys(w.overrides).length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-muted-foreground">
        <span>Walking rules · whole project</span>
        {changed > 0 && (
          <button type="button" onClick={w.resetAll} className="normal-case tracking-normal hover:text-foreground" title="Back to the automatic values">
            <RotateCcw className="inline h-3 w-3" /> all automatic
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        One set of rules for what counts as somewhere a person can stand and walk. Arrange (joints, reachability, Auto Generate) and Analysis (routes, usable
        space) both use it, so changing a value here changes both and recomputes every result that depends on it. Proto-architecture tolerances, not code compliance.
      </p>
      {WALK_FIELDS.map((f) => {
        const overridden = f.key in w.overrides;
        return (
          <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_1.25rem] items-center gap-2" title={f.hint}>
            <span className="text-[11px] text-muted-foreground">{f.label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={w.rules[f.key]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) w.set(f.key, Math.max(f.min, Math.min(f.max, v)));
                }}
                className={`h-7 w-full rounded-md border bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums outline-none focus-visible:border-ring ${overridden ? "border-magenta/60 text-foreground" : "border-input text-muted-foreground"}`}
                aria-label={f.label}
              />
              <span className="w-6 shrink-0 text-[10px] text-muted-foreground">{f.unit}</span>
            </div>
            {overridden ? (
              <button type="button" onClick={() => w.reset(f.key)} className="text-muted-foreground hover:text-foreground" title={`Back to automatic (${w.defaults[f.key]} ${f.unit})`} aria-label={`Restore ${f.label}`}>
                <RotateCcw className="h-3 w-3" />
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">
        A height change bigger than one step is never walkable by a setting: it needs actual stair or ramp geometry (a run of floors each within one step of the
        next). Floors that are close but more than a step apart are reported as needing a connector, not as routes.
      </p>
    </div>
  );
}
