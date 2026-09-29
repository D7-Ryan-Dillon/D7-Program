"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ParsedTile } from "@/lib/types";

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
 * NOTE: this is an in-memory store for the current tab only. Tile data
 * (voxels, GLBs) is not yet synced anywhere -- real cross-device persistence
 * needs a database + file storage provisioned first (see project plan).
 * Only the project code itself is remembered locally, as a convenience.
 */
type ProjectState = {
  projectCode: string | null;
  tiles: ParsedTile[];
  activeTileId: string | null;
  enterProject: (code: string) => void;
  leaveProject: () => void;
  addTile: (tile: ParsedTile) => void;
  removeTile: (id: string) => void;
  setActiveTile: (id: string | null) => void;
  lastUsedCode: string | null;
};

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectCode, setProjectCode] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ParsedTile[]>([]);
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const lastUsedCode = useSyncExternalStore(subscribeToLastCode, getLastCodeSnapshot, getLastCodeServerSnapshot);

  const enterProject = useCallback((rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return;
    setProjectCode(code);
    setTiles([]);
    setActiveTileId(null);
    window.localStorage.setItem(LAST_CODE_KEY, code);
  }, []);

  const leaveProject = useCallback(() => {
    setProjectCode(null);
    setTiles([]);
    setActiveTileId(null);
  }, []);

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

  const value = useMemo<ProjectState>(
    () => ({
      projectCode,
      tiles,
      activeTileId,
      enterProject,
      leaveProject,
      addTile,
      removeTile,
      setActiveTile: setActiveTileId,
      lastUsedCode,
    }),
    [projectCode, tiles, activeTileId, enterProject, leaveProject, addTile, removeTile, lastUsedCode],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside a ProjectProvider");
  return ctx;
}
