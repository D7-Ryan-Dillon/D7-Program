"use client";

// One keyboard-shortcut registry for the whole program. Each tab (and the app itself) registers the shortcuts it has
// right now with `useShortcuts`; a single listener runs them, and the key bar at the bottom of the screen is drawn from
// the same registry, so what it shows is always exactly what works. Shortcuts are scoped to the active tab, ignored
// while typing in a field, and a definition with no `run` is a hint about a mouse gesture (shown, not bound).

import { createContext, useContext, useEffect, useId, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";

export interface ShortcutDef {
  /** e.g. "R", "Ctrl+Z", "Shift+Click", "Alt+1", "Delete", "?" */
  keys: string;
  label: string;
  /** a heading in the full list */
  group?: string;
  /** what it does; absent = a hint about a mouse gesture */
  run?: (e: KeyboardEvent) => void;
}

interface Entry {
  scope: string;
  defs: ShortcutDef[];
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getVersion = () => version;

const ActiveScope = createContext<string>("global");

const MODS = new Set(["ctrl", "cmd", "mod", "shift", "alt"]);
const KEY_ALIASES: Record<string, string> = { esc: "escape", del: "delete", space: " ", return: "enter", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };

function parse(keys: string) {
  const parts = keys.split("+").map((p) => p.trim());
  const last = (parts.length > 1 && parts[parts.length - 1] === "" ? "+" : parts[parts.length - 1]).toLowerCase();
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()).filter((p) => MODS.has(p)));
  return { key: KEY_ALIASES[last] ?? last, mod: mods.has("ctrl") || mods.has("cmd") || mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt") };
}

function matches(e: KeyboardEvent, keys: string): boolean {
  const k = parse(keys);
  if (k.key === "click" || k.key === "drag") return false;
  const mod = e.ctrlKey || e.metaKey;
  if (k.mod !== mod || k.alt !== e.altKey) return false;
  // a shifted symbol (?, +, {) already says shift in its own character; letters, digits and named keys need it to agree
  const symbol = k.key.length === 1 && !/[a-z0-9]/.test(k.key);
  if (!symbol && k.shift !== e.shiftKey) return false;
  if (k.alt && /^[0-9]$/.test(k.key)) return e.code === `Digit${k.key}`;
  return e.key.toLowerCase() === k.key;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
};

/** Registers a tab's (or the app's) shortcuts while it is mounted. Pass the freshest defs each render; closures stay current. */
export function useShortcuts(scope: string, defs: ShortcutDef[]) {
  const id = useId();
  const ref = useRef(defs);
  useEffect(() => {
    ref.current = defs;
  });
  // the registry only needs to rebuild when the visible list (keys + labels) changes, not on every render
  const sig = defs.map((d) => `${d.keys}|${d.label}|${d.group ?? ""}|${d.run ? 1 : 0}`).join(";");
  useEffect(() => {
    entries.set(id, { scope, defs: ref.current.map((d, i) => ({ ...d, run: d.run ? (e: KeyboardEvent) => ref.current[i]?.run?.(e) : undefined })) });
    emit();
    return () => {
      entries.delete(id);
      emit();
    };
  }, [id, scope, sig]);
}

/** Everything registered for a tab plus the global ones, in registration order, one per key. */
export function useActiveShortcuts(tab: string): ShortcutDef[] {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const out: ShortcutDef[] = [];
  const seen = new Set<string>();
  for (const scope of [tab, "global"])
    for (const e of entries.values()) {
      if (e.scope !== scope) continue;
      for (const d of e.defs) {
        const k = `${d.keys}|${d.label}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(d);
      }
    }
  return out;
}

/** Wraps the workspace: runs the matching shortcut of the active tab (or a global one) on a key press. */
export function ShortcutProvider({ tab, children }: { tab: string; children: ReactNode }) {
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.repeat && !/arrow|\[|\]/i.test(e.key))) return;
      if (isTyping(e.target) && e.key !== "Escape") return;
      if (document.querySelector('[data-slot="dialog-content"]') && e.key !== "Escape") return;
      for (const scope of [tabRef.current, "global"])
        for (const entry of entries.values()) {
          if (entry.scope !== scope) continue;
          for (const d of entry.defs) {
            if (!d.run || !matches(e, d.keys)) continue;
            e.preventDefault();
            d.run(e);
            return;
          }
        }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <ActiveScope.Provider value={tab}>{children}</ActiveScope.Provider>;
}

export const useActiveScope = () => useContext(ActiveScope);

/** Keys as they are shown on the bar ("Ctrl" becomes "Ctrl/⌘" only in the help). */
export const prettyKeys = (keys: string) => keys.replace(/\bArrowUp\b/i, "↑").replace(/\bArrowDown\b/i, "↓").replace(/\bArrowLeft\b/i, "←").replace(/\bArrowRight\b/i, "→").replace(/\bDelete\b/i, "Del").replace(/\bEscape\b/i, "Esc");

export function useGroupedShortcuts(tab: string) {
  const list = useActiveShortcuts(tab);
  return useMemo(() => {
    const groups = new Map<string, ShortcutDef[]>();
    for (const d of list) groups.set(d.group ?? "General", [...(groups.get(d.group ?? "General") ?? []), d]);
    return [...groups.entries()];
  }, [list]);
}
