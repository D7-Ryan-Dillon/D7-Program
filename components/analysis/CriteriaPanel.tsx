"use client";

import { Section } from "@/components/shared/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MATRIX, type MatrixKey } from "@/lib/scoring/matrix";
import { useEvaluation } from "@/lib/useEvaluation";

type PinChoice = "auto" | "on" | "off";

function PinSelect({ value, onChange }: { value: PinChoice; onChange: (v: PinChoice) => void }) {
  return (
    <Select className="h-6 rounded border border-input bg-transparent px-1 text-[10px]" value={value} onChange={(e) => onChange(e.target.value as PinChoice)} aria-label="Always on or off" title="Always on: always carried. Always off: never carried. Auto: as suggested.">
      <option value="auto">Auto</option>
      <option value="on">Always on</option>
      <option value="off">Always off</option>
    </Select>
  );
}

const nameOf = (k: MatrixKey) => MATRIX.find((m) => m.key === k)?.name ?? k;

/**
 * Which of the matrix's criteria this project carries forward for this phase, and why. It is suggested automatically from the whole set of tiles (how
 * well each can be assessed, how good the evidence is, whether it tells the tiles apart, whether the typologies are about it, whether it repeats another)
 * and adopted at once; there is no minimum number. When the tiles change what would be suggested, the change is shown here and takes effect when you
 * adopt it (every tile is then read the same way again). Pins and your own wording are optional overrides.
 */
export function CriteriaPanel() {
  const ev = useEvaluation();
  const { profile, suggestion, diff, keys, reasons, setAside, actions, tiles, ready } = ev;
  const stats = new Map((suggestion?.stats ?? []).map((s) => [s.key, s]));
  const asideKeys = MATRIX.map((m) => m.key).filter((k) => !keys.includes(k));
  const mig = profile.migration && !profile.migration.dismissed ? profile.migration.notes : null;
  const overridden = Object.keys(profile.overrides.pins).length + Object.keys(profile.overrides.reasons).length;

  return (
    <div className="glass-panel rounded-lg">
      <Section
        id="analysis.criteria"
        title="Criteria carried forward"
        summary={`${keys.length} · ${overridden ? "with your changes" : "automatic"}`}
        action={
          overridden ? (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={actions.resetAll} title="Put every pin, reason, threshold, route and written reading back to automatic">
              Back to automatic
            </Button>
          ) : (
            <span className="rounded-full border-hair px-2 py-0.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">automatic</span>
          )
        }
      >
        <p className="text-[11px] text-muted-foreground">
          {tiles.length
            ? `Suggested from the ${tiles.length} tile${tiles.length === 1 ? "" : "s"} in this project: carried where a criterion can be assessed, rests on good evidence, tells the tiles apart or matches what their typologies are about, and does not repeat another. There is no minimum. Nothing here has to be reviewed. The Boards sheets list only these.`
            : "Load tiles and the criteria worth carrying are suggested here."}
          {!ready && tiles.length > 0 && " Reading the tiles…"}
        </p>

        {mig && (
          <div className="rounded-md border border-orange/40 bg-orange/5 p-2.5 text-[11px] text-muted-foreground">
            <div className="mb-1 font-mono uppercase tracking-label text-orange">From your earlier version of this project</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {mig.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2 h-6 px-2 text-[10px]" onClick={actions.dismissMigration}>
              Got it
            </Button>
          </div>
        )}

        {diff?.changed && suggestion && (
          <div className="rounded-md border border-magenta/50 bg-magenta/5 p-2.5 text-[11px]">
            <div className="mb-1 font-mono uppercase tracking-label text-magenta">A different set is now suggested</div>
            <p className="text-muted-foreground">The tiles have changed what the evidence supports. The criteria in use have not changed; adopt the suggestion to read every tile against the new set.</p>
            <ul className="mt-1.5 space-y-1">
              {diff.add.map((k) => (
                <li key={k}>
                  <span className="text-pink">+ {nameOf(k)}</span> <span className="text-muted-foreground">{suggestion.reasons[k]}</span>
                </li>
              ))}
              {diff.remove.map((k) => (
                <li key={k}>
                  <span className="text-orange">− {nameOf(k)}</span> <span className="text-muted-foreground">{suggestion.setAside[k]}</span>
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-2 h-7 text-[11px]" onClick={actions.adopt}>
              Adopt the suggestion and recompute the set
            </Button>
          </div>
        )}

        <ul className="space-y-2">
          {keys.map((key) => {
            const stat = stats.get(key);
            const pin = profile.overrides.pins[key] ?? "auto";
            const mine = profile.overrides.reasons[key] !== undefined;
            return (
              <li key={key} className="space-y-1.5 rounded-md border-hair bg-white/[0.02] p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{nameOf(key)}</span>
                  {stat && <span className="font-mono text-[10px] text-muted-foreground">assessable for {Math.round(stat.availability * 100)}% of tiles</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    <PinSelect value={pin} onChange={(v) => actions.pin(key, v === "auto" ? null : v)} />
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input key={reasons[key]} defaultValue={reasons[key] ?? ""} onBlur={(e) => e.target.value !== (reasons[key] ?? "") && actions.setReason(key, e.target.value)} className="h-7 text-[11px]" aria-label={`Why ${nameOf(key)} is carried forward`} />
                  {mine && (
                    <button type="button" className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => actions.setReason(key, "")} title="Go back to the generated reasoning">
                      reset
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {!keys.length && tiles.length > 0 && <li className="text-[11px] text-muted-foreground">Nothing is carried yet: no criterion is both assessable and telling for these tiles. You can pin any criterion on.</li>}
        </ul>

        {asideKeys.length > 0 && (
          <Section id="analysis.criteria.aside" variant="inline" title={`Set aside (${asideKeys.length})`} defaultOpen={false}>
            <ul className="space-y-1.5 text-xs">
              {asideKeys.map((key) => (
                <li key={key} className="flex flex-wrap items-center gap-2 rounded-md border-hair px-2.5 py-1.5">
                  <span className="font-medium">{nameOf(key)}</span>
                  <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{setAside[key]}</span>
                  <PinSelect value={profile.overrides.pins[key] ?? "auto"} onChange={(v) => actions.pin(key, v === "auto" ? null : v)} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Section>
    </div>
  );
}
