"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  CATEGORY_LABEL,
  PROGRAM_CATEGORIES,
  RULE_LEVELS,
  pairKey,
  type CountRange,
  type RuleLevel,
  type ProgramRules,
} from "@/lib/arrange/types";
import { toFt } from "@/lib/arrange/geometry";
import { Cap, Chip, Num } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";

const LEVEL_WORD: Record<RuleLevel, string> = {
  preferred: "Preferred",
  allowed: "Allowed",
  avoid: "Avoid",
  never: "Never",
};
const PAIRS: [string, string][] = [
  ["lobby", "gathering"],
  ["gathering", "office"],
  ["lobby", "office"],
  ["gathering", "gathering"],
  ["office", "office"],
  ["lobby", "lobby"],
];

const LevelSelect = ({
  value,
  onChange,
  label,
}: {
  value: RuleLevel;
  onChange: (v: RuleLevel) => void;
  label: string;
}) => (
  <Select
    className="h-7 w-full text-[11px]"
    value={value}
    onChange={(e) => onChange(e.target.value as RuleLevel)}
    aria-label={label}
  >
    {RULE_LEVELS.map((l) => (
      <option key={l} value={l}>
        {LEVEL_WORD[l]}
      </option>
    ))}
  </Select>
);

const Range = ({
  label,
  r,
  onChange,
}: {
  label: string;
  r: CountRange;
  onChange: (r: CountRange) => void;
}) => (
  <div className="grid grid-cols-[1fr_56px_56px] items-center gap-2 text-[11px]">
    <span className="truncate text-muted-foreground">{label}</span>
    <Num
      value={r.min}
      min={0}
      max={99}
      decimals={0}
      onChange={(v) => onChange({ ...r, min: Math.round(v) })}
    />
    <Num
      value={r.max}
      min={0}
      max={99}
      decimals={0}
      onChange={(v) => onChange({ ...r, max: Math.round(v) })}
    />
  </div>
);

/** Which kinds of tile may touch, how many of each, and the limits the generator and the Warnings list hold the arrangement to. */
export function ProgramPanel() {
  const A = useArrange();
  const rules = A.ui.rules;
  const set = (patch: Partial<ProgramRules>) =>
    A.patchUi({ rules: { ...rules, ...patch } });
  const none: CountRange = { min: 0, max: 0 };
  const setAdj = (
    a: string,
    b: string,
    which: "side" | "stacked",
    v: RuleLevel,
  ) => {
    const k = pairKey(a, b);
    const cur = rules.adjacency[k] ?? { side: "allowed", stacked: "allowed" };
    set({ adjacency: { ...rules.adjacency, [k]: { ...cur, [which]: v } } });
  };
  const site = A.ui.site;
  const setSite = (p: Partial<typeof site>) =>
    A.patchUi({ site: { ...site, ...p } });
  const fitSite = () => {
    const b = A.layout.bounds;
    if (!b) return;
    setSite({
      enabled: true,
      min: [toFt(b.min[0]) - 10, toFt(b.min[1]) - 10],
      size: [toFt(b.max[0] - b.min[0]) + 20, toFt(b.max[1] - b.min[1]) + 20],
    });
  };
  const topTiles = A.bank.length ? A.bank : A.tiles;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Cap>What may touch what</Cap>
        <p className="text-[10px] text-muted-foreground">
          Never is a hard rule everywhere (the generator, suggestions and the
          warnings). Preferred and Avoid are weights.
        </p>
        <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-[11px]">
          <span />
          <Cap>Side by side</Cap>
          <Cap>Stacked</Cap>
          {PAIRS.map(([a, b]) => {
            const adj = rules.adjacency[pairKey(a, b)] ?? {
              side: "allowed" as RuleLevel,
              stacked: "allowed" as RuleLevel,
            };
            return [
              <span key={`${a}${b}`} className="truncate text-muted-foreground">
                {CATEGORY_LABEL[a as keyof typeof CATEGORY_LABEL]} ·{" "}
                {CATEGORY_LABEL[b as keyof typeof CATEGORY_LABEL]}
              </span>,
              <LevelSelect
                key={`${a}${b}s`}
                value={adj.side}
                label={`${a} ${b} side by side`}
                onChange={(v) => setAdj(a, b, "side", v)}
              />,
              <LevelSelect
                key={`${a}${b}t`}
                value={adj.stacked}
                label={`${a} ${b} stacked`}
                onChange={(v) => setAdj(a, b, "stacked", v)}
              />,
            ];
          })}
        </div>
        <div className="space-y-1.5 pt-1">
          <Cap>Tile pairs (overrides)</Cap>
          {rules.tilePairs.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate">
                {A.tileById.get(p.a)?.name ?? "?"} ·{" "}
                {A.tileById.get(p.b)?.name ?? "?"}
              </span>
              <div className="w-24">
                <LevelSelect
                  value={p.level}
                  label="level"
                  onChange={(v) =>
                    set({
                      tilePairs: rules.tilePairs.map((x, k) =>
                        k === i ? { ...x, level: v } : x,
                      ),
                    })
                  }
                />
              </div>
              <button
                type="button"
                aria-label="Remove override"
                className="text-muted-foreground hover:text-destructive"
                onClick={() =>
                  set({ tilePairs: rules.tilePairs.filter((_, k) => k !== i) })
                }
              >
                ×
              </button>
            </div>
          ))}
          {topTiles.length > 1 && (
            <PairAdder
              onAdd={(a, b, level) =>
                set({
                  tilePairs: [
                    ...rules.tilePairs.filter(
                      (p) =>
                        !((p.a === a && p.b === b) || (p.a === b && p.b === a)),
                    ),
                    { a, b, level },
                  ],
                })
              }
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Cap>How many</Cap>
        <div className="grid grid-cols-[1fr_56px_56px] gap-2">
          <span />
          <Cap className="text-right">Min</Cap>
          <Cap className="text-right">Max</Cap>
        </div>
        <Range
          label="Pieces in total"
          r={rules.counts.total}
          onChange={(r) => set({ counts: { ...rules.counts, total: r } })}
        />
        {PROGRAM_CATEGORIES.map((c) => (
          <Range
            key={c}
            label={CATEGORY_LABEL[c]}
            r={rules.counts.perCategory[c] ?? none}
            onChange={(r) =>
              set({
                counts: {
                  ...rules.counts,
                  perCategory: { ...rules.counts.perCategory, [c]: r },
                },
              })
            }
          />
        ))}
        <div className="grid grid-cols-[1fr_56px] items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">
            Most copies of one tile (0 = any)
          </span>
          <Num
            value={rules.counts.maxCopies}
            min={0}
            max={99}
            decimals={0}
            onChange={(v) =>
              set({ counts: { ...rules.counts, maxCopies: Math.round(v) } })
            }
          />
        </div>
        {A.bank.length > 0 && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Per tile
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {A.bank.map((t) => (
                <Range
                  key={t.id}
                  label={t.name}
                  r={rules.counts.perTile[t.id] ?? none}
                  onChange={(r) =>
                    set({
                      counts: {
                        ...rules.counts,
                        perTile: { ...rules.counts.perTile, [t.id]: r },
                      },
                    })
                  }
                />
              ))}
            </div>
          </details>
        )}
      </div>

      <details className="space-y-4 border-t border-border pt-3">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground">
          Limits, site and route order
        </summary>
        <div className="space-y-4 pt-3">
          <div className="space-y-2">
            <Cap>Limits</Cap>
            <div className="grid grid-cols-3 gap-2">
              <Num
                label="Height"
                value={rules.limits.maxHeightFt}
                min={0}
                max={999}
                decimals={0}
                suffix="ft"
                onChange={(v) =>
                  set({
                    limits: { ...rules.limits, maxHeightFt: Math.round(v) },
                  })
                }
              />
              <Num
                label="Span"
                value={rules.limits.maxFootprintFt}
                min={0}
                max={999}
                decimals={0}
                suffix="ft"
                onChange={(v) =>
                  set({
                    limits: { ...rules.limits, maxFootprintFt: Math.round(v) },
                  })
                }
              />
              <Num
                label="Hang"
                value={rules.limits.maxOverhangFt}
                min={0}
                max={99}
                decimals={0}
                suffix="ft"
                onChange={(v) =>
                  set({
                    limits: { ...rules.limits, maxOverhangFt: Math.round(v) },
                  })
                }
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              0 = no limit. Height of the whole, longest side of the footprint,
              how far a piece may overhang.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Floors that meet within
              <Select
                className="h-7 flex-1 text-[11px]"
                value={rules.levelTolerance}
                onChange={(e) =>
                  set({
                    levelTolerance: e.target
                      .value as ProgramRules["levelTolerance"],
                  })
                }
                aria-label="Level tolerance"
              >
                <option value="exact">Exact (6 in)</option>
                <option value="riser">One riser (1.5 ft)</option>
                <option value="ramp">A ramp</option>
              </Select>
            </div>
            {rules.levelTolerance === "ramp" && (
              <Num
                label="Ramp rise"
                value={rules.rampRiseFt}
                min={1.5}
                max={10}
                step={0.5}
                suffix="ft"
                onChange={(v) => set({ rampRiseFt: v })}
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                Site limit
              </Label>
              <Switch
                checked={site.enabled}
                onCheckedChange={(v) => setSite({ enabled: v })}
              />
            </div>
            {site.enabled && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num
                    label="X"
                    value={site.min[0]}
                    decimals={0}
                    onChange={(v) => setSite({ min: [v, site.min[1]] })}
                  />
                  <Num
                    label="Y"
                    value={site.min[1]}
                    decimals={0}
                    onChange={(v) => setSite({ min: [site.min[0], v] })}
                  />
                  <Num
                    label="Width"
                    value={site.size[0]}
                    min={20}
                    decimals={0}
                    onChange={(v) => setSite({ size: [v, site.size[1]] })}
                  />
                  <Num
                    label="Depth"
                    value={site.size[1]}
                    min={20}
                    decimals={0}
                    onChange={(v) => setSite({ size: [site.size[0], v] })}
                  />
                </div>
                <Num
                  label="Max height"
                  value={site.maxHeight}
                  min={0}
                  decimals={0}
                  suffix="ft"
                  onChange={(v) => setSite({ maxHeight: v })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={fitSite}
                  disabled={!A.layout.bounds}
                >
                  Fit around the arrangement
                </Button>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Cap>Sequence order</Cap>
            <div className="flex flex-wrap gap-1">
              {PROGRAM_CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  active={rules.sequenceOrder[0] === c}
                  onClick={() =>
                    set({
                      sequenceOrder: [
                        c,
                        ...rules.sequenceOrder.filter((x) => x !== c),
                      ],
                    })
                  }
                  title="Which kind comes first on a route"
                >
                  {CATEGORY_LABEL[c]} first
                </Chip>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              A route should move{" "}
              {rules.sequenceOrder.map((c) => CATEGORY_LABEL[c]).join(" → ")}.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

function PairAdder({
  onAdd,
}: {
  onAdd: (a: string, b: string, level: RuleLevel) => void;
}) {
  const A = useArrange();
  const tiles = A.bank.length > 1 ? A.bank : A.tiles;
  const a = tiles[0]?.id ?? "";
  const b = tiles[1]?.id ?? "";
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Add a pair…
      </summary>
      <PairForm
        tiles={tiles.map((t) => ({ id: t.id, name: t.name }))}
        a0={a}
        b0={b}
        onAdd={onAdd}
      />
    </details>
  );
}

function PairForm({
  tiles,
  a0,
  b0,
  onAdd,
}: {
  tiles: { id: string; name: string }[];
  a0: string;
  b0: string;
  onAdd: (a: string, b: string, level: RuleLevel) => void;
}) {
  const [a, setA] = useState(a0);
  const [b, setB] = useState(b0);
  const [level, setLevel] = useState<RuleLevel>("never");
  return (
    <div className="mt-1.5 space-y-1.5">
      <Select
        className="h-7 w-full text-[11px]"
        value={a}
        onChange={(e) => setA(e.target.value)}
        aria-label="First tile"
      >
        {tiles.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <Select
        className="h-7 w-full text-[11px]"
        value={b}
        onChange={(e) => setB(e.target.value)}
        aria-label="Second tile"
      >
        {tiles.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <div className="flex gap-1.5">
        <div className="flex-1">
          <LevelSelect value={level} label="level" onChange={setLevel} />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => a && b && a !== b && onAdd(a, b, level)}
          disabled={!a || !b || a === b}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
