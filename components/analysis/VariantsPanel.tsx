"use client";

import { RotateCcw } from "lucide-react";
import { Section } from "@/components/shared/Section";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/analysis/MatrixCard";
import { MATRIX, type MatrixKey } from "@/lib/scoring/matrix";
import { interpretationFor } from "@/lib/scoring/profile";
import { intentionText, type CriterionComparison, type PreferenceMode, type VariantRow } from "@/lib/scoring/compareSet";
import { useEvaluation } from "@/lib/useEvaluation";

const VERDICT_LABEL = { pick: "Suggested variant", tradeoff: "A tradeoff, not a winner", tie: "No difference to choose on", insufficient: "Not enough to decide", single: "One variant" } as const;
const AGAINST_TONE: Record<VariantRow["against"], string> = { within: "text-pink", near: "text-foreground", outside: "text-orange", "no preference": "text-muted-foreground", "not assessable": "text-muted-foreground" };
const AGAINST_TEXT: Record<VariantRow["against"], string> = { within: "within the target", near: "near the target", outside: "outside the target", "no preference": "", "not assessable": "not assessable" };

/**
 * Variants of one typology side by side. Three things are kept apart: how strong each quality is (the measurement and its scale word), how well it fits what this
 * typology is about (a target range the system assumes, never "more is better"; you can change it), and whether the space is usable (floor reached on foot). A
 * variant is suggested only where the evidence supports one; otherwise the tradeoffs are written out. The typologies are never ranked against each other.
 */
export function VariantsPanel() {
  const ev = useEvaluation();
  const { groups, evals, keys, picks, profile, actions, ready } = ev;
  const multi = groups.filter((g) => g.tiles.length > 1);
  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.variants" title="Typologies and variants" summary={multi.length ? `${multi.length} with variants` : `${groups.length} typolog${groups.length === 1 ? "y" : "ies"}`} defaultOpen={multi.length > 0}>
        <p className="text-[11px] text-muted-foreground">Variants are tiles of the same typology, read with the criteria this project carries and the same assumptions. Strength of a quality, fit to what the typology is about, and usability are shown apart; a suggestion is made only where the evidence supports one, and the rules it uses are the system&apos;s assumptions (not assignment requirements) that you can change.</p>
        {!ready && <p className="text-[11px] text-muted-foreground">Reading the tiles…</p>}
        {ready && multi.length === 0 && <p className="text-[11px] text-muted-foreground">Every typology here has one tile. Load a second variant of a typology (the same type with a different seed or recipe) and it is compared automatically.</p>}
        {ready &&
          groups.map((g) => {
            const pick = picks.get(g.key);
            const mine = profile.overrides.picks[g.key];
            const chosen = mine ?? (pick?.supported ? pick.tileId : null);
            const mineTargets = profile.overrides.targets?.[g.key] ?? {};
            const shown = (keys.length ? keys : MATRIX.map((m) => m.key)) as MatrixKey[];
            const byKey = new Map<MatrixKey, CriterionComparison>((pick?.basis ?? []).map((b) => [b.key, b]));
            return (
              <div key={g.key} className="space-y-2 rounded-md border-hair p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">{g.label}</h4>
                  <span className="font-mono text-[10px] text-muted-foreground">{g.tiles.length} variants</span>
                </div>
                <div className="flex items-start gap-1.5 text-[11px]">
                  <textarea
                    key={intentionText(g, profile.overrides.intentions[g.key]).text}
                    defaultValue={intentionText(g, profile.overrides.intentions[g.key]).text}
                    onBlur={(e) => {
                      const auto = intentionText(g).text;
                      if (e.target.value.trim() !== intentionText(g, profile.overrides.intentions[g.key]).text.trim()) actions.setIntention(g.key, e.target.value.trim() === auto.trim() ? "" : e.target.value);
                    }}
                    rows={2}
                    className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 leading-relaxed text-muted-foreground outline-none focus-visible:border-ring"
                    aria-label={`Spatial intention of ${g.label}`}
                    title="Generated from the typology's name; write the real intention to replace it. It is used on the boards."
                  />
                  {profile.overrides.intentions[g.key] && (
                    <button type="button" onClick={() => actions.setIntention(g.key, "")} className="mt-1 shrink-0 text-muted-foreground hover:text-foreground" title="Back to the generated line" aria-label="Back to the generated line">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {g.tiles.length > 1 && pick && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-max border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Criterion · rule</th>
                            {g.tiles.map((t) => (
                              <th key={t.id} className={`px-2 py-1.5 font-mono text-[10px] uppercase tracking-label ${chosen === t.id ? "text-pink" : "text-muted-foreground"}`}>
                                {t.name}
                                {chosen === t.id ? " · pick" : ""}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((k) => {
                            const cmp = byKey.get(k);
                            const over = mineTargets[k];
                            return (
                              <tr key={k} className="border-b border-border/60 align-top last:border-0">
                                <td className="max-w-[15rem] px-2 py-1.5">
                                  <div className="font-medium">{MATRIX.find((m) => m.key === k)!.name}</div>
                                  {cmp && (
                                    <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                                      <span title={cmp.pref.why}>{cmp.rule}</span> · {cmp.source}
                                      {cmp.role === "supporting" ? " · proxy or assumed: supports, never decides" : ""}
                                      {cmp.notUsed ? ` · ${cmp.notUsed}` : ""}
                                    </div>
                                  )}
                                  <RuleEditor typology={g.key} k={k} cmp={cmp} overridden={!!over} set={actions.setTarget} />
                                </td>
                                {g.tiles.map((t) => {
                                  const r = evals.get(t.id)?.results.find((x) => x.key === k);
                                  if (!r) return <td key={t.id} />;
                                  const reading = interpretationFor(profile, t.id, r);
                                  const row = cmp?.rows.find((x) => x.id === t.id);
                                  return (
                                    <td key={t.id} className="max-w-[16rem] px-2 py-1.5">
                                      <div className="font-mono text-[11px] text-foreground">{r.measure.headline}</div>
                                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                        <StatusBadge status={r.measure.status} />
                                        {row && row.strength !== "not assessable" && <span className="text-[10px] text-muted-foreground">strength: {row.strength}</span>}
                                        {row && AGAINST_TEXT[row.against] && <span className={`text-[10px] ${AGAINST_TONE[row.against]}`}>{AGAINST_TEXT[row.against]}</span>}
                                        {reading.edited && <span className="text-[9px] text-muted-foreground">edited</span>}
                                      </div>
                                      <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{reading.text}</div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto rounded-md bg-white/[0.03] p-2.5">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Usability · reached on foot under the walking rules</div>
                      <table className="w-full min-w-max border-collapse text-[11px]">
                        <tbody>
                          {pick.usability.map((u) => (
                            <tr key={u.id} className="align-top">
                              <td className="pr-3 font-medium">{u.tile}</td>
                              <td className="pr-3 font-mono">{u.usableShare === null ? "no floor read" : `${Math.round(u.usableShare * 100)}% of floor`}</td>
                              <td className="pr-3 font-mono text-muted-foreground">{u.zones ? `${u.zonesReached}/${u.zones} floor zones` : "no floor zones"}</td>
                              <td className="pr-3 font-mono text-muted-foreground">{u.levelsTotal ? `${u.levelsReached}/${u.levelsTotal} levels` : ""}</td>
                              <td className={u.problems.length ? "text-orange" : "text-muted-foreground"}>{u.problems.length ? u.problems.join("; ") : "no usability problem found"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-md bg-white/[0.03] p-2.5 text-[11px]">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                        {VERDICT_LABEL[pick.verdict]} {mine ? "· yours" : pick.supported ? "· from the evidence" : ""}
                      </div>
                      <p className="leading-relaxed text-muted-foreground">{profile.overrides.pickReasons[g.key] ?? pick.rationale}</p>
                      {pick.tradeoffs.length > 0 && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] leading-snug text-muted-foreground">
                          {pick.tradeoffs.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      )}
                      {pick.assumptions.length > 0 && (
                        <details className="mt-1.5 text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground">The rules this used: the system&apos;s assumptions for this typology, not assignment requirements</summary>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-snug">
                            {pick.assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select className="h-7 w-52 text-[11px]" value={mine ?? ""} onChange={(e) => actions.setPick(g.key, e.target.value || null)} aria-label={`Selection for ${g.label}`}>
                          <option value="">{pick.supported ? "As suggested" : "No pick (as suggested)"}</option>
                          {g.tiles.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                        <input
                          key={profile.overrides.pickReasons[g.key] ?? "auto"}
                          defaultValue={profile.overrides.pickReasons[g.key] ?? ""}
                          placeholder="Your own reason (optional)"
                          onBlur={(e) => e.target.value !== (profile.overrides.pickReasons[g.key] ?? "") && actions.setPickReason(g.key, e.target.value)}
                          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[11px] outline-none focus-visible:border-ring"
                          aria-label="Your reason for the selection"
                        />
                        {(mine || profile.overrides.pickReasons[g.key]) && (
                          <button
                            type="button"
                            onClick={() => {
                              actions.setPick(g.key, null);
                              actions.setPickReason(g.key, "");
                            }}
                            className="text-muted-foreground hover:text-foreground"
                            title="Back to the suggestion"
                            aria-label="Back to the suggestion"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </Section>
    </div>
  );
}

/** Optional: change what counts as a good value of this criterion for this typology; the arrow puts the system's assumption back. */
function RuleEditor({ typology, k, cmp, overridden, set }: { typology: string; k: MatrixKey; cmp: CriterionComparison | undefined; overridden: boolean; set: (typology: string, key: MatrixKey, t: { mode: PreferenceMode; lo?: number; hi?: number } | null) => void }) {
  if (!cmp) return null;
  const p = cmp.pref;
  const num = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <Select
        className="h-6 w-28 rounded border border-input bg-transparent px-1 text-[10px]"
        value={p.mode}
        onChange={(e) => {
          const mode = e.target.value as PreferenceMode;
          set(typology, k, { mode, lo: p.lo ?? 0, hi: p.hi ?? 1 });
        }}
        aria-label={`Preference for ${cmp.name}`}
      >
        <option value="descriptive">Described only</option>
        <option value="target">Target range</option>
        <option value="higher">More, up to</option>
        <option value="lower">Less, from</option>
      </Select>
      {p.mode !== "descriptive" && (
        <>
          <input type="number" step="any" defaultValue={p.lo} key={`lo${p.lo}${p.mode}`} onBlur={(e) => { const v = num(e.target.value); if (v !== undefined && v !== p.lo) set(typology, k, { mode: p.mode, lo: v, hi: p.hi }); }} className="h-6 w-14 rounded border border-input bg-transparent px-1 text-right font-mono text-[10px]" aria-label={`${cmp.name}: from`} />
          <span className="text-[10px] text-muted-foreground">to</span>
          <input type="number" step="any" defaultValue={p.hi} key={`hi${p.hi}${p.mode}`} onBlur={(e) => { const v = num(e.target.value); if (v !== undefined && v !== p.hi) set(typology, k, { mode: p.mode, lo: p.lo, hi: v }); }} className="h-6 w-14 rounded border border-input bg-transparent px-1 text-right font-mono text-[10px]" aria-label={`${cmp.name}: to`} />
        </>
      )}
      {overridden && (
        <button type="button" onClick={() => set(typology, k, null)} className="text-muted-foreground hover:text-foreground" title="Back to the system's assumption" aria-label={`Restore the system's rule for ${cmp.name}`}>
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
