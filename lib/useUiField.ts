"use client";

import { useCallback } from "react";

/** One field of a persisted settings object (see useProjectUi) as a
 * useState-style pair, so a tab with many `useState`s can keep its component
 * body nearly as it was while the values now save with the project. */
export function useUiField<T extends object, K extends keyof T>(ui: T, setUi: (update: (prev: T) => T) => void, key: K) {
  const set = useCallback(
    (next: T[K] | ((prev: T[K]) => T[K])) =>
      setUi((prev) => ({ ...prev, [key]: typeof next === "function" ? (next as (p: T[K]) => T[K])(prev[key]) : next })),
    [setUi, key],
  );
  return [ui[key], set] as const;
}
