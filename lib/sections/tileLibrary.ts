// The Sections tab's tile bank: the 48 baked photos + their pre-computed
// vector traces (public/section-field), plus whatever new photos the user
// adds and manual corrections drawn over any of them.
//
// Corrections are kept in this browser's localStorage, not synced through
// Supabase (unlike ParsedTile itself) -- deliberately the smaller lift for
// now, consistent with how Section-Field's own standalone correction
// editor prototype persisted drafts before its full app grew a backend.
// Worth revisiting if corrections need to follow a project across devices.
//
// `name` is a tile's stable identity -- for baked tiles it's also the
// literal asset path / vector-JSON lookup key (IMG_5204 etc.), so it must
// never change. `displayName` is the separate, freely-editable label the UI
// actually shows -- new uploads and the 48 baked photos alike default to
// sequential "Tile N" names rather than a raw filename, overridable per
// tile via renameTile() without touching `name` or anything keyed by it.

import type { SectionTrace } from "./volumeField";

export interface BankTile {
  name: string;
  displayName: string;
  src: string;
  /** The best available starting trace -- a saved correction if one
   * exists, otherwise the baked-in auto-trace proposal. */
  proposal: SectionTrace;
  /** True once the user has drawn their own correction over this tile. */
  corrected: boolean;
}

interface VectorLibraryFile {
  tiles: Record<string, Record<string, { solid: string }>>;
}

const CORRECTIONS_KEY = "section-field:corrections:v1";
const NEW_TILES_KEY = "section-field:new-tiles:v1";
const DISPLAY_NAMES_KEY = "section-field:display-names:v1";

function readCorrections(): Record<string, SectionTrace> {
  try {
    return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveCorrection(name: string, correction: SectionTrace) {
  const all = readCorrections();
  all[name] = correction;
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(all));
  } catch {
    // Local storage can be full/unavailable (private browsing); the editor
    // still works for the rest of the session, it just won't survive a reload.
  }
}

export function getCorrection(name: string): SectionTrace | null {
  return readCorrections()[name] ?? null;
}

function readDisplayNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISPLAY_NAMES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeDisplayNames(all: Record<string, string>) {
  try {
    localStorage.setItem(DISPLAY_NAMES_KEY, JSON.stringify(all));
  } catch {
    // Same best-effort persistence as saveCorrection.
  }
}

/** Renames a tile's display label only -- `name` (the stable id used for
 * baked assets/corrections/dedup) is never touched. */
export function renameTile(name: string, displayName: string) {
  const trimmed = displayName.trim();
  const all = readDisplayNames();
  if (trimmed) all[name] = trimmed;
  else delete all[name];
  writeDisplayNames(all);
}

/** One past the highest "Tile N" among the given display names -- scanned
 * fresh each time rather than a separately persisted counter, so deleting
 * tiles never leaves a permanently-skipped number or a collision. */
export function nextTileNumber(existingDisplayNames: string[]): number {
  let max = 0;
  for (const name of existingDisplayNames) {
    const match = /^Tile (\d+)$/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

interface NewTileRecord {
  name: string;
  src: string; // a data: URL, so it survives a reload without a backend
  proposal: SectionTrace;
}

function readNewTiles(): NewTileRecord[] {
  try {
    return JSON.parse(localStorage.getItem(NEW_TILES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeNewTiles(tiles: NewTileRecord[]) {
  try {
    localStorage.setItem(NEW_TILES_KEY, JSON.stringify(tiles));
  } catch {
    // See saveCorrection -- same best-effort persistence.
  }
}

export function addNewTile(record: NewTileRecord) {
  writeNewTiles([...readNewTiles().filter((t) => t.name !== record.name), record]);
}

/** Loads the baked tile-vectors.json/correction-proposals.json and merges
 * in any locally-saved corrections, display-name overrides, and user-added
 * tiles, newest-added first for the user's own uploads, baked tiles in
 * their export order. Every tile defaults to a sequential "Tile N" display
 * name (baked tiles numbered by their sorted position, new uploads
 * continuing the sequence) unless explicitly renamed. */
export async function loadTileBank(): Promise<BankTile[]> {
  const [proposals, library] = await Promise.all([
    fetch("/section-field/vectors/correction-proposals.json").then((r) => r.json() as Promise<Record<string, SectionTrace>>),
    fetch("/section-field/vectors/tile-vectors.json").then((r) => r.json() as Promise<VectorLibraryFile>),
  ]);
  const corrections = readCorrections();
  const overrides = readDisplayNames();

  const baked: BankTile[] = Object.keys(library.tiles)
    .sort()
    .map((name, i) => {
      const correction = corrections[name];
      return {
        name,
        displayName: overrides[name] ?? `Tile ${i + 1}`,
        src: `/section-field/assets/${name}.png`,
        proposal: correction ?? proposals[name] ?? { width: 100, height: 100, shapes: [] },
        corrected: !!correction,
      };
    });

  const added: BankTile[] = readNewTiles().map((t) => {
    const correction = corrections[t.name];
    return {
      name: t.name,
      displayName: overrides[t.name] ?? t.name,
      src: t.src,
      proposal: correction ?? t.proposal,
      corrected: !!correction,
    };
  });

  return [...added, ...baked];
}
