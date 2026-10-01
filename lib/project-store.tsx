"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ParsedTile } from "@/lib/types";
import { loadProject, saveProject } from "@/lib/persistence";

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
  activeTileId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  enterProject: (code: string) => void;
  leaveProject: () => void;
  addTile: (tile: ParsedTile) => void;
  removeTile: (id: string) => void;
  updateTile: (id: string, patch: Partial<ParsedTile>) => void;
  setActiveTile: (id: string | null) => void;
  lastUsedCode: string | null;
};

const ProjectContext = createContext<ProjectState | null>(null);
const AUTOSAVE_DELAY_MS = 1200;

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectCode, setProjectCode] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ParsedTile[]>([]);
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setActiveTileId(null);
    setSaveStatus("loading");
    window.localStorage.setItem(LAST_CODE_KEY, code);

    loadProject(code)
      .then((loaded) => {
        if (loaded) setTiles(loaded);
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
    setActiveTileId(null);
    setSaveStatus("idle");
  }, []);

  useEffect(() => {
    if (!projectCode || readyForCode.current !== projectCode) return;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      saveProject(projectCode, tiles)
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
  }, [tiles, projectCode]);

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
  }, []);

  const updateTile = useCallback((id: string, patch: Partial<ParsedTile>) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo<ProjectState>(
    () => ({
      projectCode,
      tiles,
      activeTileId,
      saveStatus,
      saveError,
      enterProject,
      leaveProject,
      addTile,
      removeTile,
      updateTile,
      setActiveTile: setActiveTileId,
      lastUsedCode,
    }),
    [projectCode, tiles, activeTileId, saveStatus, saveError, enterProject, leaveProject, addTile, removeTile, updateTile, lastUsedCode],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside a ProjectProvider");
  return ctx;
}
