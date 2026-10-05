// Everything measured from an arrangement's combined voxels: the tile metrics, face and section data, and the full spaces /
// structure / plates analysis. Pure arithmetic (no DOM, no three), so it runs unchanged in a web worker, where the heavy
// reading of a big arrangement (seconds) stays off the page, and on the main thread when workers are unavailable.

import type { FacesJson, ParsedTile, SectionsJson, TileMetrics } from "@/lib/types";
import type { PlateEntry, SpacesData, StructureInfo } from "@/lib/tiles/types";
import { measureFaces, measureMetrics, measureSections } from "@/lib/tiles/measure";
import { ensureAnalysis } from "@/lib/tiles/pipeline";

export interface BundleInput {
  /** 1 = void, already limited to the inside of the pieces */
  void: Uint8Array;
  grid: [number, number, number];
  cell: number;
  plates: Uint8Array | null;
  struts: Uint8Array | null;
  mask: Uint8Array;
}

export interface Bundle {
  metrics: TileMetrics;
  faces: FacesJson;
  sections: SectionsJson;
  spaces: SpacesData;
  structure: StructureInfo;
  rooms: Uint8Array;
  plates?: PlateEntry[];
}

export function computeBundle(input: BundleInput): Bundle {
  const m = { void: input.void, grid: input.grid, cell: input.cell, plates: input.plates, mask: input.mask };
  const base = {
    id: "bundle",
    name: "bundle",
    sourceFolderName: "bundle",
    tileFt: [input.grid[0] * input.cell, input.grid[1] * input.cell, input.grid[2] * input.cell] as [number, number, number],
    cellFt: input.cell,
    grid: input.grid,
    config: {},
    metrics: measureMetrics(m),
    glbUrl: "",
    voxels: { void: input.void, mask: input.mask, plates: input.plates ?? undefined, struts: input.struts ?? undefined },
    faces: measureFaces(m),
    sections: measureSections(m),
    guessed: {},
  } as ParsedTile;
  const t = ensureAnalysis(base);
  return { metrics: t.metrics, faces: t.faces!, sections: t.sections!, spaces: t.spaces!, structure: t.structure!, rooms: t.voxels.rooms!, plates: t.plates };
}
