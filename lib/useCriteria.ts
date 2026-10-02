"use client";

import { useCallback, useMemo } from "react";
import { useProject, useProjectUi } from "@/lib/project-store";
import {
  autoSelect,
  computeStats,
  defaultCriteriaState,
  MAX_CRITERIA,
  MIN_CRITERIA,
  resolveCriteria,
  type CriteriaState,
  type CriterionPin,
} from "@/lib/scoring/selection";
import type { DescriptorKey } from "@/lib/scoring/descriptors";

/** The project's carried-forward criteria: computed from every tile in the
 * project, edited by hand when wanted, saved with the project. The Analysis
 * tab edits it; the Boards tab's descriptor page only shows what it carries. */
export function useCriteria() {
  const { tiles } = useProject();
  const [state, setState] = useProjectUi<CriteriaState>("criteria", defaultCriteriaState);
  const stats = useMemo(() => computeStats(tiles), [tiles]);
  const resolved = useMemo(() => resolveCriteria(state, stats), [state, stats]);

  /** Switches to hand-edited mode starting from what is currently carried. */
  const edit = useCallback(
    (change: (keys: DescriptorKey[], prev: CriteriaState) => Partial<CriteriaState>) =>
      setState((prev) => {
        const keys = resolveCriteria(prev, stats).keys;
        return { ...prev, manual: true, keys, ...change(keys, prev) };
      }),
    [setState, stats],
  );

  const actions = useMemo(
    () => ({
      setCount: (count: number) =>
        setState((prev) => {
          const n = Math.max(MIN_CRITERIA, Math.min(MAX_CRITERIA, Math.round(count)));
          if (!prev.manual) return { ...prev, count: n };
          const keys = resolveCriteria(prev, stats).keys;
          if (n === keys.length) return prev;
          if (n > keys.length) {
            const extra = autoSelect(stats, MAX_CRITERIA, prev.pins).filter((k) => !keys.includes(k));
            return { ...prev, count: n, keys: [...keys, ...extra].slice(0, n) };
          }
          const removable = keys.filter((k) => prev.pins[k] !== "on");
          const drop = new Set(removable.slice(-(keys.length - n)));
          return { ...prev, count: n, keys: keys.filter((k) => !drop.has(k)) };
        }),
      remove: (key: DescriptorKey) => edit((keys, prev) => (keys.length <= MIN_CRITERIA || prev.pins[key] === "on" ? {} : { keys: keys.filter((k) => k !== key) })),
      add: (key: DescriptorKey) => edit((keys, prev) => (keys.includes(key) || keys.length >= MAX_CRITERIA ? {} : { keys: [...keys, key], pins: { ...prev.pins, [key]: prev.pins[key] === "off" ? undefined : prev.pins[key] } })),
      swap: (out: DescriptorKey, into: DescriptorKey) =>
        edit((keys, prev) => (prev.pins[out] === "on" ? {} : { keys: keys.map((k) => (k === out ? into : k)), pins: { ...prev.pins, [into]: prev.pins[into] === "off" ? undefined : prev.pins[into] } })),
      setPin: (key: DescriptorKey, pin: CriterionPin | null) =>
        setState((prev) => {
          const pins = { ...prev.pins };
          if (pin) pins[key] = pin;
          else delete pins[key];
          return { ...prev, pins };
        }),
      setNote: (key: DescriptorKey, text: string) =>
        setState((prev) => {
          const notes = { ...prev.notes };
          if (text === "") delete notes[key];
          else notes[key] = text;
          return { ...prev, notes };
        }),
      /** Back to the automatic pick (pins and your notes stay). */
      refresh: () => setState((prev) => ({ ...prev, manual: false, keys: [] })),
    }),
    [setState, stats, edit],
  );

  return { state, stats, keys: resolved.keys, reasons: resolved.reasons, setAside: resolved.setAside, actions, tileCount: tiles.length };
}
