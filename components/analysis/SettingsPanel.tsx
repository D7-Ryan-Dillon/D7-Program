"use client";

import { RotateCcw } from "lucide-react";
import { Section } from "@/components/shared/Section";
import { Select } from "@/components/ui/select";
import { ASSUMPTION_FIELDS, DEFAULT_ASSUMPTIONS } from "@/lib/scoring/assumptions";
import { useEvaluation } from "@/lib/useEvaluation";
import type { ParsedTile } from "@/lib/types";

const CATS = ["gathering", "office", "lobby"] as const;

/**
 * Everything the measurements assume, in one place, optional: thresholds and settings with their automatic values, which program counts as public,
 * each room's class, and which route a tile is read along. Each can be changed on its own and restored on its own; nothing here has to be touched.
 */
export function SettingsPanel({ tile }: { tile: ParsedTile | undefined }) {
  const ev = useEvaluation();
  const { assumptions, profile, actions } = ev;
  const changed = profile.overrides.assumptions;
  const rooms = tile?.spaces?.rooms ?? [];
  const route = tile ? profile.overrides.routes[tile.id] : undefined;
  const numeric = ASSUMPTION_FIELDS.map((f) => {
    const overridden = f.key in changed;
    const value = assumptions[f.key] as number;
    return (
      <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_1.25rem] items-center gap-2" title={f.hint}>
        <span className="text-[11px] text-muted-foreground">{f.label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={f.min}
            max={f.max}
            step={f.step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) actions.setAssumption(f.key, Math.max(f.min, Math.min(f.max, v)) as never);
            }}
            className={`h-7 w-full rounded-md border bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums outline-none focus-visible:border-ring ${overridden ? "border-magenta/60 text-foreground" : "border-input text-muted-foreground"}`}
            aria-label={f.label}
          />
        </div>
        {overridden ? (
          <button type="button" onClick={() => actions.resetAssumption(f.key)} className="text-muted-foreground hover:text-foreground" title={`Back to automatic (${DEFAULT_ASSUMPTIONS[f.key] as number} ${f.unit})`} aria-label={`Restore ${f.label}`}>
            <RotateCcw className="h-3 w-3" />
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  });
  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.settings" title="Assumptions and overrides" summary={`${Object.keys(changed).length + Object.keys(profile.overrides.routes).length} changed`} defaultOpen={false}>
        <p className="text-[11px] text-muted-foreground">Optional. The automatic values are used unless you change one, and every tile in the comparison is read with the same ones. A changed value is outlined; the arrow puts it back.</p>

        <div className="space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Thresholds</div>
          {numeric}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-muted-foreground">
            <span>Threaded: which program is public</span>
            {changed.publicCategories && (
              <button type="button" onClick={() => actions.resetAssumption("publicCategories")} className="normal-case tracking-normal hover:text-foreground" title="Back to automatic">
                <RotateCcw className="inline h-3 w-3" /> automatic
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]">
            {CATS.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-[var(--magenta)]"
                  checked={assumptions.publicCategories.includes(c)}
                  onChange={(e) => actions.setAssumption("publicCategories", e.target.checked ? [...new Set([...assumptions.publicCategories, c])] : assumptions.publicCategories.filter((x) => x !== c))}
                />
                {c}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">A room&apos;s program is public only if its category is ticked. A room with no category is never assumed public.</p>
        </div>

        {tile && (
          <>
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Rooms of {tile.name}: public or private</div>
              {rooms.length === 0 && <p className="text-[11px] text-muted-foreground">This tile has no rooms.</p>}
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {rooms.map((r) => {
                  const key = `${tile.id}:${r.id}`;
                  const v = assumptions.roomClass[key];
                  return (
                    <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground" title={r.name}>
                        {r.name.split(",")[0]} · floor {r.floor_z_ft.min === null ? "n/a" : `${r.floor_z_ft.min.toFixed(0)} ft`}
                      </span>
                      <Select className="h-6 rounded border border-input bg-transparent px-1 text-[10px]" value={v ?? "auto"} onChange={(e) => actions.setRoomClass(tile.id, r.id, e.target.value === "auto" ? null : (e.target.value as "public" | "private"))} aria-label={`Class of ${r.name}`}>
                        <option value="auto">Automatic</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                <span>Route for {tile.name}</span>
                {route && (
                  <button type="button" onClick={() => actions.setRoute(tile.id, null)} className="normal-case tracking-normal hover:text-foreground" title="Back to the automatic route">
                    <RotateCcw className="inline h-3 w-3" /> automatic
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Chosen automatically: from the largest ground-level opening, to the middle of the largest other room (counting routes) or the farthest point reached on foot (reading a passage). You may choose the destination room or the side of the entry.</p>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  className="h-7 text-[11px]"
                  value={route?.to ? String(rooms.find((r) => Math.abs(r.centroid_ft[0] - route.to![0]) < 0.01 && Math.abs(r.centroid_ft[1] - route.to![1]) < 0.01)?.id ?? "") : ""}
                  onChange={(e) => {
                    const r = rooms.find((x) => String(x.id) === e.target.value);
                    actions.setRoute(tile.id, { ...route, to: r ? [r.centroid_ft[0], r.centroid_ft[1], r.floor_z_ft.min ?? r.centroid_ft[2]] : undefined });
                  }}
                  aria-label="Destination room"
                >
                  <option value="">Destination: automatic</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name.split(",")[0]}
                    </option>
                  ))}
                </Select>
                <Select
                  className="h-7 text-[11px]"
                  value={route?.from ? "set" : ""}
                  onChange={(e) => {
                    const side = e.target.value;
                    const [w, d] = tile.tileFt;
                    const lowest = Math.min(...(tile.spaces?.levels ?? [{ z_ft: 0 }]).map((l) => l.z_ft)) + 0.5;
                    const p: Record<string, [number, number, number]> = { "-X": [1, d / 2, lowest], "+X": [w - 1, d / 2, lowest], "-Y": [w / 2, 1, lowest], "+Y": [w / 2, d - 1, lowest] };
                    actions.setRoute(tile.id, { ...route, from: side ? p[side] : undefined });
                  }}
                  aria-label="Entry side"
                >
                  <option value="">Entry: automatic</option>
                  {route?.from && <option value="set">(as set)</option>}
                  {["-X", "+X", "-Y", "+Y"].map((s) => (
                    <option key={s} value={s}>
                      Entry on the {s} side
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
