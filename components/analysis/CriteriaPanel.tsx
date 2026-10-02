"use client";

import { Select } from "@/components/ui/select";
import { X } from "lucide-react";
import { Section } from "@/components/shared/Section";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CRITERIA, MIN_CRITERIA, type CriterionPin } from "@/lib/scoring/selection";
import { useCriteria } from "@/lib/useCriteria";
import type { DescriptorKey } from "@/lib/scoring/descriptors";

type PinChoice = "auto" | CriterionPin;

function PinSelect({ value, onChange }: { value: PinChoice; onChange: (v: PinChoice) => void }) {
  return (
    <Select className="h-6 rounded border border-input bg-transparent px-1 text-[10px]" value={value} onChange={(e) => onChange(e.target.value as PinChoice)} aria-label="Always on or off" title="Always on: always carried. Always off: never carried. Auto: chosen for you.">
      <option value="auto">Auto</option>
      <option value="on">Always on</option>
      <option value="off">Always off</option>
    </Select>
  );
}

/** The project's carried-forward criteria: how many, which, and why. Picked
 * automatically from how every tile in the project scores (the strongest, most
 * telling ones), then editable by hand -- never fewer than 6. Whatever is
 * carried here is what the Boards tab's descriptor page lists. */
export function CriteriaPanel() {
  const { state, stats, keys, reasons, setAside, actions, tileCount } = useCriteria();
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const asideKeys = stats.map((s) => s.key).filter((k) => !keys.includes(k));

  return (
    <div className="glass-panel rounded-lg">
      <Section
        id="analysis.criteria"
        title="Criteria carried forward"
        summary={`${keys.length} · ${state.manual ? "edited by hand" : "automatic"}`}
        action={
          <>
            <span className="rounded-full border-hair px-2 py-0.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">{state.manual ? "edited by hand" : "automatic"}</span>
            {state.manual && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={actions.refresh} title="Throw away hand edits and pick again (pins and your notes stay)">
                Refresh suggestion
              </Button>
            )}
          </>
        }
      >
      <p className="text-[11px] text-muted-foreground">
        {tileCount
          ? `Picked from how the ${tileCount} tile${tileCount === 1 ? "" : "s"} in this project score. The Boards descriptor page lists only these.`
          : "Load tiles and the strongest criteria for them are picked here."}
      </p>

      <div className="max-w-xs">
        <NumberSlider label={`How many to carry (${MIN_CRITERIA}-${MAX_CRITERIA})`} value={keys.length} min={MIN_CRITERIA} max={MAX_CRITERIA} onChange={actions.setCount} />
      </div>

      <ul className="space-y-2">
        {keys.map((key) => {
          const stat = byKey.get(key);
          const pin = state.pins[key] ?? "auto";
          const canRemove = keys.length > MIN_CRITERIA && pin !== "on";
          return (
            <li key={key} className="space-y-1.5 rounded-md border-hair bg-white/[0.02] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{stat?.label ?? key}</span>
                {stat && tileCount > 0 && <span className="font-mono text-[10px] text-muted-foreground">{Math.round(stat.min)}–{Math.round(stat.max)} across tiles</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  <PinSelect value={pin} onChange={(v) => actions.setPin(key, v === "auto" ? null : v)} />
                  {asideKeys.length > 0 && pin !== "on" && (
                    <Select
                      className="h-6 max-w-[8.5rem] rounded border border-input bg-transparent px-1 text-[10px]"
                      value=""
                      onChange={(e) => e.target.value && actions.swap(key, e.target.value as DescriptorKey)}
                      aria-label={`Replace ${stat?.label ?? key} with another criterion`}
                    >
                      <option value="">Swap for…</option>
                      {asideKeys.map((k) => (
                        <option key={k} value={k}>
                          {byKey.get(k)?.label ?? k}
                        </option>
                      ))}
                    </Select>
                  )}
                  <button
                    type="button"
                    disabled={!canRemove}
                    onClick={() => actions.remove(key)}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                    aria-label={`Remove ${stat?.label ?? key}`}
                    title={keys.length <= MIN_CRITERIA ? `At least ${MIN_CRITERIA} criteria stay carried` : pin === "on" ? "Pinned on" : "Remove from the carried criteria"}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Input value={reasons[key] ?? ""} onChange={(e) => actions.setNote(key, e.target.value)} className="h-7 text-[11px]" aria-label={`Why ${stat?.label ?? key} is carried forward`} />
                {state.notes[key] !== undefined && (
                  <button type="button" className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => actions.setNote(key, "")} title="Go back to the generated reasoning">
                    reset
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {asideKeys.length > 0 && (
        <Section id="analysis.criteria.aside" variant="inline" title={`Set aside (${asideKeys.length})`} defaultOpen={false}>
          <ul className="space-y-1.5 text-xs">
            {asideKeys.map((key) => (
              <li key={key} className="flex flex-wrap items-center gap-2 rounded-md border-hair px-2.5 py-1.5">
                <span className="font-medium">{byKey.get(key)?.label ?? key}</span>
                <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{setAside[key]}</span>
                <PinSelect value={state.pins[key] ?? "auto"} onChange={(v) => actions.setPin(key, v === "auto" ? null : v)} />
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={keys.length >= MAX_CRITERIA} onClick={() => actions.add(key)}>
                  Carry forward
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      </Section>
    </div>
  );
}
