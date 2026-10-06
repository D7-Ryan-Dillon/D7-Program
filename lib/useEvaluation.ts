"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProject, useProjectUi } from "@/lib/project-store";
import type { ParsedTile } from "@/lib/types";
import { assumptionsKey, type Assumptions } from "@/lib/scoring/assumptions";
import { evaluateTile, type TileEvaluation } from "@/lib/scoring/matrixEval";
import type { MatrixKey } from "@/lib/scoring/matrix";
import { adoptFrom, defaultProfile, diffSuggestion, effectiveAssumptions, effectiveCriteria, emptyOverrides, migrateLegacy, suggestCriteria, withAssumption, withInterpretation, withIntention, withPick, withPickReason, withPin, withReason, withRoomClass, withRoute, withoutAssumption, type EvaluationProfile } from "@/lib/scoring/profile";
import { suggestPick, typologyGroups, type Pick, type TypologyGroup } from "@/lib/scoring/compareSet";
import type { RouteOverride0 } from "@/lib/scoring/voxelFacts";

/**
 * The project's evaluation, fully automatic: every tile is read against the matrix as it arrives (a few at a time, so the page stays usable), the
 * criteria to carry forward are suggested from the whole set and adopted, and the set's profile is kept. Everything you can change is an optional
 * override, saved with the project, restorable one field at a time.
 */
export function useEvaluation() {
  const { tiles, ui } = useProject();
  const [profile, setProfile] = useProjectUi<EvaluationProfile>("evaluation", defaultProfile);
  const assumptions = useMemo(() => effectiveAssumptions(profile), [profile]);
  const routes = profile.overrides.routes;
  const inputs = useMemo(() => ({ assumptions, routes }), [assumptions, routes]);
  const key = useMemo(() => assumptionsKey(assumptions) + JSON.stringify(routes), [assumptions, routes]);

  // ---- every tile, read as it arrives ------------------------------------------------------------------------------------------------------
  const [done, setDone] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const doneRef = useRef(done);
  useEffect(() => {
    doneRef.current = done;
  });
  useEffect(() => {
    let cancelled = false;
    const todo = tiles.filter((t) => !(doneRef.current.key === key && doneRef.current.ids.has(t.id)));
    if (!todo.length) return;
    (async () => {
      const ids = new Set(doneRef.current.key === key ? doneRef.current.ids : []);
      for (const t of todo) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;
        evaluateTile(t, inputs);
        ids.add(t.id);
        setDone({ key, ids: new Set(ids) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tiles, key, inputs]);
  const ready = done.key === key && tiles.every((t) => done.ids.has(t.id));

  /** A tile's evaluation (read now if it has not been yet: the tile on screen never waits). */
  const evaluate = useCallback((tile: ParsedTile): TileEvaluation => evaluateTile(tile, inputs), [inputs]);
  const evals = useMemo(() => {
    const m = new Map<string, TileEvaluation>();
    if (done.key === key) for (const t of tiles) if (done.ids.has(t.id)) m.set(t.id, evaluateTile(t, inputs));
    return m;
  }, [tiles, done, key, inputs]);

  // ---- the criteria: suggested from the whole set, adopted automatically the first time, then changed only by you ---------------------------------
  const suggestion = useMemo(() => (ready && tiles.length ? suggestCriteria(tiles, tiles.map((t) => evals.get(t.id)!)) : null), [ready, tiles, evals]);
  // an older project: its pins and written reasons become overrides (once), and the old list is not converted
  const legacy = ui["criteria"];
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || profile.adopted || profile.migration) return;
    if (legacy === undefined) return;
    migrated.current = true;
    const m = migrateLegacy(legacy);
    if (m) setProfile((prev) => (prev.adopted || prev.migration ? prev : { ...prev, overrides: { ...prev.overrides, pins: { ...m.overrides.pins, ...prev.overrides.pins }, reasons: { ...m.overrides.reasons, ...prev.overrides.reasons } }, migration: m.migration }));
  }, [legacy, profile.adopted, profile.migration, setProfile]);
  useEffect(() => {
    if (suggestion && !profile.adopted && tiles.length) setProfile((prev) => (prev.adopted ? prev : { ...prev, adopted: adoptFrom(suggestion, tiles) }));
  }, [suggestion, profile.adopted, tiles, setProfile]);
  const diff = useMemo(() => (suggestion && profile.adopted ? diffSuggestion(profile, suggestion) : null), [suggestion, profile]);
  const crit = useMemo(() => effectiveCriteria(profile), [profile]);

  // ---- variants of one typology -------------------------------------------------------------------------------------------------------------
  const groups = useMemo<TypologyGroup[]>(() => typologyGroups(tiles), [tiles]);
  const picks = useMemo(() => {
    const out = new Map<string, Pick>();
    if (ready) for (const g of groups) out.set(g.key, suggestPick(g, evals, crit.keys));
    return out;
  }, [ready, groups, evals, crit.keys]);

  // ---- the optional controls: each changes one thing and can be put back -------------------------------------------------------------------------
  const actions = useMemo(
    () => ({
      adopt: () => suggestion && setProfile((prev) => ({ ...prev, adopted: adoptFrom(suggestion, tiles) })),
      pin: (k: MatrixKey, v: "on" | "off" | null) => setProfile((p) => withPin(p, k, v)),
      setReason: (k: MatrixKey, text: string) => setProfile((p) => withReason(p, k, text)),
      setInterpretation: (tileId: string, k: MatrixKey, text: string) => setProfile((p) => withInterpretation(p, tileId, k, text)),
      setAssumption: <K extends keyof Assumptions>(field: K, value: Assumptions[K]) => setProfile((p) => withAssumption(p, field, value)),
      resetAssumption: (field: keyof Assumptions) => setProfile((p) => withoutAssumption(p, field)),
      setRoomClass: (tileId: string, roomId: number, cls: "public" | "private" | null) => setProfile((p) => withRoomClass(p, tileId, roomId, cls)),
      setRoute: (tileId: string, r: RouteOverride0 | null) => setProfile((p) => withRoute(p, tileId, r)),
      setPick: (typology: string, tileId: string | null) => setProfile((p) => withPick(p, typology, tileId)),
      setPickReason: (typology: string, text: string) => setProfile((p) => withPickReason(p, typology, text)),
      setIntention: (typology: string, text: string) => setProfile((p) => withIntention(p, typology, text)),
      dismissMigration: () => setProfile((prev) => (prev.migration ? { ...prev, migration: { ...prev.migration, dismissed: true } } : prev)),
      /** every override back to automatic (the adopted criteria stay) */
      resetAll: () => setProfile((prev) => ({ ...prev, overrides: emptyOverrides() })),
    }),
    [suggestion, tiles, setProfile],
  );

  return { tiles, profile, assumptions, ready, evaluate, evals, suggestion, diff, keys: crit.keys, reasons: crit.reasons, setAside: crit.setAside, groups, picks, actions };
}
