"use client";

import { useCallback, useReducer } from "react";

// Undo and redo for a document: every committed change is kept, the newest is current. `replace` changes the current
// state without adding an undo step (a drag in progress, a recomputed name), `reset` starts a fresh history.

interface H<T> {
  past: T[];
  present: T;
  future: T[];
}
type A<T> = { type: "commit"; next: T } | { type: "replace"; next: T } | { type: "undo" } | { type: "redo" } | { type: "reset"; next: T };
const LIMIT = 120;

function reducer<T>(s: H<T>, a: A<T>): H<T> {
  switch (a.type) {
    case "commit":
      if (a.next === s.present) return s;
      return { past: [...s.past, s.present].slice(-LIMIT), present: a.next, future: [] };
    case "replace":
      return { ...s, present: a.next };
    case "undo":
      return s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s;
    case "redo":
      return s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s;
    case "reset":
      return { past: [], present: a.next, future: [] };
  }
}

export function useHistory<T>(initial: T) {
  const [s, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [] } as H<T>);
  return {
    doc: s.present,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    commit: useCallback((next: T) => dispatch({ type: "commit", next }), []),
    replace: useCallback((next: T) => dispatch({ type: "replace", next }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((next: T) => dispatch({ type: "reset", next }), []),
  };
}
