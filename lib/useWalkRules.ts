"use client";

import { useCallback } from "react";
import { useProjectUi } from "@/lib/project-store";
import { DEFAULT_WALK, setWalkRules, WALK, walkKey, type WalkRules } from "@/lib/walking";

/** What the project changed about the walking rules (only the changed fields; an absent field is the automatic value). */
export interface WalkUi {
  overrides: Partial<WalkRules>;
}
const defaultWalkUi = (): WalkUi => ({ overrides: {} });

/**
 * The project's walking rules (headroom, clear width, one step, the smallest space): ONE set, shared by Arrange (joints, reachability, the generator),
 * Analysis (every route-based descriptor, the usable-space check) and anything built on them. They are optional overrides on top of the automatic
 * values, saved with the project and restorable one at a time. The rules in force are applied (idempotently) as this hook renders, before any
 * component that reads them computes anything, and every result that depends on them is keyed with `key`, so changing a rule recomputes all of them.
 */
export function useWalkRules() {
  const [ui, setUi] = useProjectUi<WalkUi>("walking", defaultWalkUi);
  const overrides = ui.overrides ?? {};
  setWalkRules(overrides);
  const set = useCallback((field: keyof WalkRules, value: number) => setUi((p) => ({ ...p, overrides: { ...p.overrides, [field]: value } })), [setUi]);
  const reset = useCallback(
    (field: keyof WalkRules) =>
      setUi((p) => {
        const o = { ...p.overrides };
        delete o[field];
        return { ...p, overrides: o };
      }),
    [setUi],
  );
  const resetAll = useCallback(() => setUi((p) => ({ ...p, overrides: {} })), [setUi]);
  return { rules: WALK, defaults: DEFAULT_WALK, overrides, key: walkKey(), set, reset, resetAll };
}
