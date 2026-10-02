"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ParsedTile } from "@/lib/types";
import { loadProject, saveProject } from "@/lib/persistence";
import type { SavedCube } from "@/lib/sections/savedCubes";
import { mergeDefaults } from "@/lib/mergeDefaults";

const LAST_CODE_KEY = "erosion-workspace:last-project-code";

// useSyncExternalStore is the correct primitive for "read a value from
// outside React (localStorage) that can differ between server and client":
// getServerSnapshot always returns null, so SSR and the first client render
// agree, and the real value (if any) is picked up right after.
function subscribeToLastCode() {
  return () => {};
}
function getLastCodeSnapshot() {
  return window.localStorage.getItem(LAST_CODE_KEY);
}
function getLastCodeServerSnapshot() {
  return null;
}

/**
 * The tile bank (Viewer tab) auto-saves to Supabase under the project code,
 * so it's the same on every device that enters that code. The Arrange tab's
 * generated composition is NOT synced yet -- it's cheap to regenerate from
 * the tiles and its engine is still being iterated on (see HANDOFF.md).
 */
export type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

type ProjectState = {
  projectCode: string | null;
  tiles: ParsedTile[];
  /** Pieces made in the Sections cube/hex builder -- kept with the project
   * whether or not they were ever added to the tile bank. */
  cubes: SavedCube[];
  /** Everything about how the workspace was left (board settings, viewport
   * layouts, presets, criteria...) -- one JSON bag per feature, saved with the
   * project so reopening a code resumes exactly where you stopped. */
  ui: Record<string, unknown>;
  setUi: (key: string, update: (prev: unknown) => unknown) => void;
  activeTileId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  enterProject: (code: string) => void;
  leaveProject: () => void;
  addTile: (tile: ParsedTile) => void;
  removeTile: (id: string) => void;
  /** Adds a saved cube, or replaces the one with the same id. */
  saveCube: (cube: SavedCube) => void;
  removeCube: (id: string) => void;
  updateTile: (id: string, patch: Partial<ParsedTile>) => void;
  setActiveTile: (id: string | null) => void;
  lastUsedCode: string | null;
  /** Tiles pinned to the front of the tile switcher (Viewer/Analysis) --
   * a working-session convenience, not synced to Supabase, so it resets
   * when the project is left. */
  pinnedTileIds: string[];
  togglePinned: (id: string) => void;
};

const ProjectContext = createContext<ProjectState | null>(null);
const AUTOSAVE_DELAY_MS = 1200;

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectCode, setProjectCode] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ParsedTile[]>([]);
  const [cubes, setCubes] = useState<SavedCube[]>([]);
  const [ui, setUiState] = useState<Record<string, unknown>>({});
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pinnedTileIds, setPinnedTileIds] = useState<string[]>([]);
  const lastUsedCode = useSyncExternalStore(subscribeToLastCode, getLastCodeSnapshot, getLastCodeServerSnapshot);

  // Guards against re-saving the tiles we just loaded for a code, and against
  // a slow load for an old code clobbering a newer one the user has since entered.
  const readyForCode = useRef<string | null>(null);

  const enterProject = useCallback((rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return;
    readyForCode.current = null;
    setProjectCode(code);
    setTiles([]);
    setCubes([]);
    setUiState({});
    setActiveTileId(null);
    setPinnedTileIds([]);
    setSaveStatus("loading");
    window.localStorage.setItem(LAST_CODE_KEY, code);

    loadProject(code)
      .then((loaded) => {
        if (loaded) {
          setTiles(loaded.tiles);
          setCubes(loaded.cubes);
          setUiState(loaded.ui);
        }
        setSaveStatus("idle");
        setSaveError(null);
      })
      .catch((err) => {
        console.error("[project-store] loadProject failed:", err);
        setSaveStatus("error");
        setSaveError(describeError(err));
      })
      .finally(() => {
        readyForCode.current = code;
      });
  }, []);

  const leaveProject = useCallback(() => {
    readyForCode.current = null;
    setProjectCode(null);
    setTiles([]);
    setCubes([]);
    setUiState({});
    setActiveTileId(null);
    setPinnedTileIds([]);
    setSaveStatus("idle");
  }, []);

  useEffect(() => {
    if (!projectCode || readyForCode.current !== projectCode) return;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      saveProject(projectCode, tiles, cubes, ui)
        .then(() => {
          setSaveStatus("saved");
          setSaveError(null);
        })
        .catch((err) => {
          console.error("[project-store] saveProject failed:", err);
          setSaveStatus("error");
          setSaveError(describeError(err));
        });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tiles, cubes, ui, projectCode]);

  const addTile = useCallback((tile: ParsedTile) => {
    setTiles((prev) => {
      const withoutDup = prev.filter((t) => t.id !== tile.id);
      return [...withoutDup, tile];
    });
    setActiveTileId(tile.id);
  }, []);

  const removeTile = useCallback((id: string) => {
    setTiles((prev) => prev.filter((t) => t.id !== id));
    setActiveTileId((current) => (current === id ? null : current));
    setPinnedTileIds((prev) => prev.filter((pinnedId) => pinnedId !== id));
  }, []);

  const saveCube = useCallback((cube: SavedCube) => {
    setCubes((prev) => (prev.some((c) => c.id === cube.id) ? prev.map((c) => (c.id === cube.id ? cube : c)) : [...prev, cube]));
  }, []);

  const removeCube = useCallback((id: string) => {
    setCubes((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const setUi = useCallback((key: string, update: (prev: unknown) => unknown) => {
    setUiState((prev) => ({ ...prev, [key]: update(prev[key]) }));
  }, []);

  const togglePinned = useCallback((id: string) => {
    setPinnedTileIds((prev) => (prev.includes(id) ? prev.filter((pinnedId) => pinnedId !== id) : [...prev, id]));
  }, []);

  const updateTile = useCallback((id: string, patch: Partial<ParsedTile>) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo<ProjectState>(
    () => ({
      projectCode,
      tiles,
      cubes,
      ui,
      setUi,
      activeTileId,
      saveStatus,
      saveError,
      enterProject,
      leaveProject,
      addTile,
      removeTile,
      saveCube,
      removeCube,
      updateTile,
      setActiveTile: setActiveTileId,
      lastUsedCode,
      pinnedTileIds,
      togglePinned,
    }),
    [projectCode, tiles, cubes, ui, setUi, activeTileId, saveStatus, saveError, enterProject, leaveProject, addTile, removeTile, saveCube, removeCube, updateTile, lastUsedCode, pinnedTileIds, togglePinned],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside a ProjectProvider");
  return ctx;
}

/** A persisted settings object for one feature: `defaults` (a stable,
 * module-level function) fills in anything the saved copy lacks, and the
 * setter takes a value or an updater like useState. Writes autosave with the
 * project. */
export function useProjectUi<T extends object>(key: string, defaults: () => T) {
  const { ui, setUi } = useProject();
  const raw = ui[key];
  const value = useMemo(() => mergeDefaults(defaults(), raw), [raw, defaults]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setUi(key, (prevRaw) => {
        const prev = mergeDefaults(defaults(), prevRaw);
        return typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      }),
    [key, setUi, defaults],
  );
  return [value, set] as const;
}
