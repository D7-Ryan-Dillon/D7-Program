// Turns a loaded tile's raw metrics (tile.json/faces.json -- everything the
// erosion engine already computed) into the geometric quantities the 12
// descriptor scorers actually read. Nothing in here is descriptor-specific;
// see descriptors.ts for that. Field names are read directly from
// erosion_engine_5f.py's tile_metrics()/export_bundle() and HANDOFF.md
// (the "8 ft2 counts as a real opening" threshold, the face-open-area
// convention, etc.), not guessed.

import { faceNamesOf, topFaceName, type FaceName, type ParsedTile } from "@/lib/types";
import { computeFaceBranches } from "./faceBranches";
import { clamp, clusterLevels } from "./utils";

const OPENING_THRESHOLD_FT2 = 8; // HANDOFF section 5: openings under ~8 ft2 aren't counted as real ports
const FLOOR_NOISE_FT2 = 4; // a patch smaller than this is rough-foam noise, not a level

export interface FloorLevel {
  zFt: number;
  areaFt2: number;
}

export interface ParsedSource {
  mode: string;
  doseFt3: number;
  hasDirection: boolean;
}

export interface ScoringPrimitives {
  voidFractionPct: number;
  retainedFractionPct: number;
  voidPieces: number;
  singlePieceFractionPct: number;

  faceOpenAreaFt2: Record<FaceName, number>;
  facesReached: FaceName[];
  facesReachedCount: number;
  totalOpenAreaFt2: number;
  topOpenAreaFt2: number;
  /** Open area on the 6 faces as a % of the void's own total mesh surface -- a
   * real ratio (how much of the void's skin actually opens to the outside),
   * not just a count of which faces cross the "reached" threshold. */
  porosityPct: number;

  /** Per-face mask decomposed into its actual connected openings (see
   * faceBranches.ts) rather than one collapsed open-area number -- e.g. two
   * separate windows on the same face are 2 distinct openings, not "this
   * face is open". */
  totalBranches: number;
  branchAreasFt2: number[];

  floorLevels: FloorLevel[];
  largestVoidFt3: number;

  voidHeightFt: number;
  voidWidthFt: number; // larger of the void bbox's X/Y extents
  heightToWidthRatio: number;
  elongationRatio: number | null; // longest bbox extent / shortest

  sequenceAxis: "x" | "y" | "z";
  sequenceProfileFt2: number[];
  narrowestFt2: number;
  widestFt2: number;
  compressionRatio: number; // narrowest / widest along the dominant axis, 0..1

  verticalProfileFt2: number[]; // void cross-section area at every Z slice, base to top
  graduatedSmoothness: number; // 0-100, how smooth the base-to-top transition reads

  skylightPct: number; // +Z open area as a % of the void's base floor area

  meshSmoothnessRatio: number; // void_mesh_area_ft2 / voxel_wall_area_ft2 (1 = as blocky as the raw voxels)
  layered: boolean;
  layerCount: number;
  layerStrength: number;
  webStrength: number;
  smoothParam: number;

  sources: ParsedSource[];
  totalDoseFt3: number;
  doseConcentration: number; // biggest source's share of total dose, 0..1
  dominantMode: string;
  gravity: number;
  drain: boolean;
}

function parseSources(raw: string[] | undefined): ParsedSource[] {
  const out: ParsedSource[] = [];
  for (const item of raw ?? []) {
    try {
      const d = JSON.parse(item);
      out.push({
        mode: typeof d.mode === "string" ? d.mode : "unknown",
        doseFt3: typeof d.dose === "number" ? d.dose : 0,
        hasDirection: d.dir != null,
      });
    } catch {
      // malformed source entry -- skip rather than fail the whole tile
    }
  }
  return out;
}

function axisProfileStats(values: number[] | undefined): { compression: number; smoothness: number } | null {
  if (!values || values.length < 4) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return null;
  const endSample = Math.max(1, Math.round(n * 0.2));
  const endsAvg = (values.slice(0, endSample).reduce((a, b) => a + b, 0) + values.slice(-endSample).reduce((a, b) => a + b, 0)) / (endSample * 2);
  const mid = values.slice(Math.floor(n * 0.35), Math.ceil(n * 0.65));
  const midMin = mid.length ? Math.min(...mid) : Math.min(...values);
  const compression = endsAvg > 0 ? Math.min(1, midMin / endsAvg) : 1;

  let roughness = 0;
  for (let i = 1; i < n; i++) roughness += Math.abs(values[i] - values[i - 1]);
  roughness /= n - 1;
  const referenceRoughness = mean * 0.35; // empirical: ~35% step-to-step change reads as "abrupt"
  const smoothness = 100 * (1 - Math.min(1, roughness / Math.max(referenceRoughness, 1e-6)));
  return { compression, smoothness };
}

export function computePrimitives(tile: ParsedTile): ScoringPrimitives {
  const { metrics, config } = tile;

  const voidFractionPct = metrics.void_fraction * 100;
  const retainedFractionPct = 100 - voidFractionPct;

  const tileFaceNames = faceNamesOf(tile);
  const faceOpenAreaFt2 = {} as Record<FaceName, number>;
  const facesReached: FaceName[] = [];
  for (const f of tileFaceNames) {
    const area = metrics.faces?.[f]?.open_area_ft2 ?? 0;
    faceOpenAreaFt2[f] = area;
    if (area >= OPENING_THRESHOLD_FT2) facesReached.push(f);
  }
  const totalOpenAreaFt2 = metrics.open_area_on_faces_ft2 ?? tileFaceNames.reduce((sum, f) => sum + faceOpenAreaFt2[f], 0);
  const topOpenAreaFt2 = faceOpenAreaFt2[topFaceName(tile)];
  const porosityPct = metrics.void_mesh_area_ft2 && metrics.void_mesh_area_ft2 > 0 ? (totalOpenAreaFt2 / metrics.void_mesh_area_ft2) * 100 : 0;

  let totalBranches = 0;
  const branchAreasFt2: number[] = [];
  for (const f of tileFaceNames) {
    for (const branch of computeFaceBranches(tile, f)) {
      totalBranches++;
      branchAreasFt2.push(branch.areaFt2);
    }
  }

  const largestVoidFt3 = metrics.largest_void_ft3 ?? metrics.void_volume_ft3;
  const singlePieceFractionPct = metrics.void_volume_ft3 > 0 ? (100 * largestVoidFt3) / metrics.void_volume_ft3 : 100;

  const floorClusters = clusterLevels(metrics.floor_area_by_z_ft2 ?? [], FLOOR_NOISE_FT2);
  const floorLevels: FloorLevel[] = floorClusters.map((c) => ({ zFt: (c.index + 0.5) * tile.cellFt, areaFt2: c.area }));

  const bbox = metrics.void_bbox;
  const voidHeightFt = bbox ? bbox.max_ft[2] - bbox.min_ft[2] : 0;
  const voidWidthFt = bbox ? Math.max(bbox.max_ft[0] - bbox.min_ft[0], bbox.max_ft[1] - bbox.min_ft[1]) : 0;
  const heightToWidthRatio = voidWidthFt > 0 ? voidHeightFt / voidWidthFt : 0;
  const bboxSpan = bbox ? [bbox.max_ft[0] - bbox.min_ft[0], bbox.max_ft[1] - bbox.min_ft[1], bbox.max_ft[2] - bbox.min_ft[2]] : null;
  const elongationRatio = bboxSpan ? Math.max(...bboxSpan) / Math.max(Math.min(...bboxSpan), 0.5) : null;

  // "the sequence" a person moves through: pick whichever axis swings most
  // between its narrowest and widest cross-section -- that's the axis where
  // a compress-then-release move would actually read.
  const profiles: { axis: "x" | "y" | "z"; values: number[] }[] = [
    { axis: "x", values: metrics.void_area_profile_ft2?.x ?? [] },
    { axis: "y", values: metrics.void_area_profile_ft2?.y ?? [] },
    { axis: "z", values: metrics.void_area_profile_ft2?.z ?? [] },
  ];
  let best = profiles[0];
  let bestSpread = -1;
  for (const p of profiles) {
    const nz = p.values.filter((v) => v > 0);
    if (nz.length < 2) continue;
    const spread = Math.max(...nz) / Math.max(Math.min(...nz), 1e-6);
    if (spread > bestSpread) {
      bestSpread = spread;
      best = p;
    }
  }
  const nzBest = best.values.filter((v) => v > 0);
  const narrowestFt2 = nzBest.length ? Math.min(...nzBest) : 0;
  const widestFt2 = nzBest.length ? Math.max(...nzBest) : 0;
  const compressionRatio = clamp(widestFt2 > 0 ? narrowestFt2 / widestFt2 : 1, 0, 1);

  const verticalProfileFt2 = metrics.void_area_profile_ft2?.z ?? [];
  const graduatedStats = axisProfileStats(verticalProfileFt2);
  const graduatedSmoothness = graduatedStats?.smoothness ?? 0;

  const baseFloorAreaFt2 = floorLevels.length > 0 ? floorLevels[0].areaFt2 : (metrics.floor_area_total_ft2 ?? 0);
  const skylightPct = baseFloorAreaFt2 > 0 ? (topOpenAreaFt2 / baseFloorAreaFt2) * 100 : 0;

  const meshSmoothnessRatio = metrics.voxel_wall_area_ft2 && metrics.voxel_wall_area_ft2 > 0 ? (metrics.void_mesh_area_ft2 ?? 0) / metrics.voxel_wall_area_ft2 : 1;

  const foam = config.foam;
  const sources = parseSources(config.sources);
  const totalDoseFt3 = sources.reduce((a, s) => a + s.doseFt3, 0);
  const maxDose = sources.reduce((a, s) => Math.max(a, s.doseFt3), 0);
  const doseConcentration = totalDoseFt3 > 0 ? maxDose / totalDoseFt3 : 0;
  const dominantSource = sources.reduce((best, s) => (s.doseFt3 > (best?.doseFt3 ?? -1) ? s : best), sources[0]);

  return {
    voidFractionPct,
    retainedFractionPct,
    voidPieces: metrics.void_pieces ?? 1,
    singlePieceFractionPct,
    faceOpenAreaFt2,
    facesReached,
    facesReachedCount: facesReached.length,
    totalOpenAreaFt2,
    topOpenAreaFt2,
    porosityPct,
    totalBranches,
    branchAreasFt2,
    floorLevels,
    largestVoidFt3,
    voidHeightFt,
    voidWidthFt,
    heightToWidthRatio,
    elongationRatio,
    sequenceAxis: best.axis,
    sequenceProfileFt2: best.values,
    narrowestFt2,
    widestFt2,
    compressionRatio,
    verticalProfileFt2,
    graduatedSmoothness,
    skylightPct,
    meshSmoothnessRatio,
    layered: foam?.layers ?? false,
    layerCount: foam?.layer_count ?? 0,
    layerStrength: foam?.layer_strength ?? 0,
    webStrength: foam?.web ?? 0,
    smoothParam: config.smooth ?? 0,
    sources,
    totalDoseFt3,
    doseConcentration,
    dominantMode: dominantSource?.mode ?? "unknown",
    gravity: config.gravity ?? 0,
    drain: !!config.drain,
  };
}
