"use client";

import { useCallback } from "react";
import { useProjectUi } from "@/lib/project-store";

export interface Preset<T = unknown> {
  id: string;
  name: string;
  data: T;
}

export type PresetKind = "boards" | "viewer" | "compare";

interface PresetStore {
  boards: Preset[];
  viewer: Preset[];
  compare: Preset[];
}

const defaultPresetStore = (): PresetStore => ({ boards: [], viewer: [], compare: [] });

function newId() {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Named presets of one kind, saved with the project. */
export function usePresets<T>(kind: PresetKind) {
  const [store, setStore] = useProjectUi<PresetStore>("presets", defaultPresetStore);
  const presets = store[kind] as Preset<T>[];

  const save = useCallback((name: string, data: T) => setStore((prev) => ({ ...prev, [kind]: [...prev[kind], { id: newId(), name: name.trim() || "Untitled", data }] })), [kind, setStore]);
  const update = useCallback((id: string, data: T) => setStore((prev) => ({ ...prev, [kind]: prev[kind].map((p) => (p.id === id ? { ...p, data } : p)) })), [kind, setStore]);
  const rename = useCallback((id: string, name: string) => setStore((prev) => ({ ...prev, [kind]: prev[kind].map((p) => (p.id === id ? { ...p, name } : p)) })), [kind, setStore]);
  const remove = useCallback((id: string) => setStore((prev) => ({ ...prev, [kind]: prev[kind].filter((p) => p.id !== id) })), [kind, setStore]);

  return { presets, save, update, rename, remove };
}
