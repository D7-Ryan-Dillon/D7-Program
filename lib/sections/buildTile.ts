// Assembles a finished ParsedTile from a cube/hex-prism face assignment --
// the single entry point lib/sections' UI (the Sections tab, not yet
// built) calls once the user is happy with a lofted preview. The result is
// built in memory, not round-tripped through a real _analysis zip -- there
// is no folder to parse, so this hands lib/project-store a ParsedTile
// directly instead of going through lib/ingest.ts.

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { FaceName, FacesJson, GuessedIdentity, ParsedTile, TileConfig, TileShape } from "@/lib/types";
import { buildVolumeField, facesForShape, type VolumeAssignments, type VolumeFaceName, type VolumeShape } from "./volumeField";
import { voxelizeVolumeField, SECTION_TILE_FT, SECTION_CELL_FT, SECTION_GRID, SECTION_HEX_APOTHEM_FT, SECTION_HEX_HEIGHT_FT } from "./voxelize";
import { buildTileScene } from "./mesh";
import { cleanupVolumeField, defaultCleanup, swapFoamVoid, type CleanupSettings } from "./cleanup";
import { computeFaceData } from "./faceData";
import { computeSectionsData } from "./sectionsData";
import { computeTileMetrics } from "./metrics";

export interface BuildSectionTileInput {
  name: string;
  shape: VolumeShape;
  /** Keyed by Section-Field's own cube/hex face names (front/back/... for a
   * cube, side1..side6/top/bottom for a hex-prism) -- see volumeField.ts. */
  assignments: VolumeAssignments;
  /** The same faces, but naming which bank tile (its stable BankTile.name,
   * not its editable display name) supplied each trace -- recorded on the
   * result as `sectionRecipe` so the tile can be reopened in the builder
   * later. Optional: a tile built without this (e.g. from an older
   * session) just won't be reload-able, nothing else depends on it. */
  assignmentNames?: Partial<Record<VolumeFaceName, string>>;
  seed?: number;
  fitTolerance?: number;
  /** Speck cleanup applied to the lofted field before meshing/voxelizing -- see lib/sections/cleanup.ts. */
  cleanup?: CleanupSettings;
  /** Foam and void roles swapped (see cleanup.ts's swapFoamVoid). */
  swapped?: boolean;
  guessed?: GuessedIdentity;
}

// A cube tile is a box tile -- it should be indistinguishable from a
// Grasshopper export once built, so its faces are relabeled from
// Section-Field's own naming onto this app's "+X/-X/+Y/-Y/+Z/-Z"
// convention rather than keeping a second name for the same 6 faces. A
// hex-prism has no Grasshopper equivalent to relabel onto, so it keeps its
// own native names (side1..side6/top/bottom) and declares them explicitly
// via ParsedTile.faceNames (see lib/types.ts's faceNamesOf()).
const CUBE_FACE_TO_BOX_FACE: Record<string, FaceName> = {
  front: "-Y",
  back: "+Y",
  left: "-X",
  right: "+X",
  top: "+Z",
  bottom: "-Z",
};

function relabelCubeAssignments(assignments: VolumeAssignments): VolumeAssignments {
  const relabeled: VolumeAssignments = {};
  for (const [face, trace] of Object.entries(assignments)) {
    const boxFace = CUBE_FACE_TO_BOX_FACE[face];
    if (boxFace && trace) (relabeled as Record<string, typeof trace>)[boxFace] = trace;
  }
  return relabeled;
}

async function hashTileId(voidVoxels: Uint8Array, extra: string): Promise<string> {
  const extraBytes = new TextEncoder().encode(extra);
  const combined = new Uint8Array(voidVoxels.length + extraBytes.length);
  combined.set(voidVoxels, 0);
  combined.set(extraBytes, voidVoxels.length);
  const digest = await crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildSectionTile(input: BuildSectionTileInput): Promise<ParsedTile> {
  const seed = input.seed ?? 1;
  const fitTolerance = input.fitTolerance ?? 50;
  const isHex = input.shape === "hex-prism";

  const cleanup = input.cleanup ?? defaultCleanup;
  const lofted = buildVolumeField(input.assignments, input.shape, seed, fitTolerance, 46);
  const volume = cleanupVolumeField(input.swapped ? swapFoamVoid(lofted) : lofted, cleanup).volume;
  const voxels = voxelizeVolumeField(volume);
  if (!voxels.void || !voxels.material || !voxels.voidSmooth) {
    throw new Error("Voxelization produced no data -- this is a bug in lib/sections/voxelize.ts, not a bad input.");
  }

  const shapeDescriptor: TileShape = isHex ? { kind: "hex-prism", apothemFt: SECTION_HEX_APOTHEM_FT, heightFt: SECTION_HEX_HEIGHT_FT } : { kind: "box" };
  const faceNames: FaceName[] | undefined = isHex ? [...facesForShape("hex-prism")] : undefined;
  const faceAssignmentsForData = isHex ? input.assignments : relabelCubeAssignments(input.assignments);

  const { faces: faceEntries, faceMetrics } = computeFaceData(shapeDescriptor, faceNames ?? ["+X", "-X", "+Y", "-Y", "+Z", "-Z"], voxels.void, SECTION_GRID, faceAssignmentsForData);
  const sections = computeSectionsData(voxels.void, SECTION_GRID, SECTION_TILE_FT);
  const metrics = computeTileMetrics(voxels.void, SECTION_GRID, SECTION_TILE_FT, faceMetrics);

  const scene = buildTileScene(volume.field, volume.resolution, SECTION_TILE_FT, input.shape);
  const exporter = new GLTFExporter();
  const glbBuffer = (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
  const glbUrl = URL.createObjectURL(new Blob([glbBuffer], { type: "model/gltf-binary" }));

  const id = await hashTileId(voxels.void, `section-field:${input.shape}:${seed}:${fitTolerance}:${input.swapped ? "swapped" : ""}`);
  const facesJson: FacesJson = { schema: "section-field-tile/1", cell_ft: SECTION_CELL_FT, faces: faceEntries };
  const config: TileConfig = { seed, cell: SECTION_CELL_FT, tile_w: SECTION_TILE_FT[0], tile_h: SECTION_TILE_FT[2] };

  return {
    id,
    name: input.name,
    sourceFolderName: input.name,
    schema: "section-field-tile/1",
    tileFt: SECTION_TILE_FT,
    cellFt: SECTION_CELL_FT,
    grid: SECTION_GRID,
    config,
    metrics,
    glbUrl,
    voxels,
    faces: facesJson,
    sections,
    guessed: input.guessed ?? {},
    shape: shapeDescriptor,
    faceNames,
    sectionRecipe: input.assignmentNames
      ? { shape: input.shape, assignments: input.assignmentNames as Record<string, string>, seed, fitTolerance, cleanup, swapped: !!input.swapped }
      : undefined,
  };
}
