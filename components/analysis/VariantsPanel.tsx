"use client";

import { RotateCcw } from "lucide-react";
import { Section } from "@/components/shared/Section";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/analysis/MatrixCard";
import { MATRIX } from "@/lib/scoring/matrix";
import { interpretationFor } from "@/lib/scoring/profile";
import { intentionText } from "@/lib/scoring/compareSet";
import { useEvaluation } from "@/lib/useEvaluation";

/**
 * Variants of one typology side by side: the same criteria, the same assumptions, the raw values and the generated reading for each. A suggested
 * selection appears only where the evidence separates the variants (and says why); you can choose another variant and write your own reason. The
 * typologies are never ranked against each other: they are not meant to have the same qualities.
 */
export function VariantsPanel() {
  const ev = useEvaluation();
  const { groups, evals, keys, picks, profile, actions, ready } = ev;
  const multi = groups.filter((g) => g.tiles.length > 1);
  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.variants" title="Typologies and variants" summary={multi.length ? `${multi.length} with variants` : `${groups.length} typolog${groups.length === 1 ? "y" : "ies"}`} defaultOpen={multi.length > 0}>
        <p className="text-[11px] text-muted-foreground">Variants are tiles of the same typology. They are read with the criteria this project carries forward and the same assumptions. A suggestion is made only where the evidence supports one.</p>
        {!ready && <p className="text-[11px] text-muted-foreground">Reading the tiles…</p>}
        {ready && multi.length === 0 && <p className="text-[11px] text-muted-foreground">Every typology here has one tile. Load a second variant of a typology (the same type with a different seed or recipe) and it is compared automatically.</p>}
        {ready &&
          groups.map((g) => {
            const pick = picks.get(g.key);
            const mine = profile.overrides.picks[g.key];
            const chosen = mine ?? (pick?.supported ? pick.tileId : null);
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
                {g.tiles.length > 1 && (<>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Criterion</th>
                        {g.tiles.map((t) => (
                          <th key={t.id} className={`px-2 py-1.5 font-mono text-[10px] uppercase tracking-label ${chosen === t.id ? "text-pink" : "text-muted-foreground"}`}>
                            {t.name}
                            {chosen === t.id ? " · pick" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(keys.length ? keys : MATRIX.map((m) => m.key)).map((k) => (
                        <tr key={k} className="border-b border-border/60 align-top last:border-0">
                          <td className="px-2 py-1.5 font-medium">{MATRIX.find((m) => m.key === k)!.name}</td>
                          {g.tiles.map((t) => {
                            const r = evals.get(t.id)?.results.find((x) => x.key === k);
                            if (!r) return <td key={t.id} />;
                            const reading = interpretationFor(profile, t.id, r);
                            return (
                              <td key={t.id} className="max-w-[16rem] px-2 py-1.5">
                                <div className="flex items-start gap-1.5">
                                  <span className="font-mono text-[11px] text-foreground">{r.measure.headline}</span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                  <StatusBadge status={r.measure.status} />
                                  {reading.edited && <span className="text-[9px] text-muted-foreground">edited</span>}
                                </div>
                                <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{reading.text}</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-md bg-white/[0.03] p-2.5 text-[11px]">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Suggested selection {mine ? "· yours" : pick?.supported ? "· from the evidence" : ""}</div>
                  <p className="leading-relaxed text-muted-foreground">{profile.overrides.pickReasons[g.key] ?? pick?.rationale}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Select className="h-7 w-52 text-[11px]" value={mine ?? ""} onChange={(e) => actions.setPick(g.key, e.target.value || null)} aria-label={`Selection for ${g.label}`}>
                      <option value="">{pick?.supported ? "As suggested" : "No pick (as suggested)"}</option>
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
                </>)}
              </div>
            );
          })}
      </Section>
    </div>
  );
}
