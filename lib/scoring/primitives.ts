import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";

/** The 8 ft2 threshold for "a real opening" is the project's own convention (HANDOFF section 5). */
const OPEN_FACE_THRESHOLD_FT2 = 8;

export interface ScoringPrimitives {
  voidFractionPct: number;
  facesReached: FaceName[];
  facesReachedCount: number;
  totalOpenAreaFt2: number;
  topOpenAreaFt2: number;
  voidPieces: number;
  singlePieceFractionPct: number;
  floorLevels: number;
  verticalSpanFt: number | null;
  elongationRatio: number | null;
  graduatedSmoothness: number | null;
  compressionRatio: number | null;
  gravity: number;
  drain: boolean;
  layerStrength: number;
  web: number;
  largestVoidFt3: number;
  zCentroidFrac: number | null;
}

function detectFloorLevels(floorAreaByZ: number[] | undefined, tileFt: [number, number, number]): number {
  if (!floorAreaByZ || floorAreaByZ.length === 0) return 0;
  const footprint = tileFt[0] * tileFt[1];
  const threshold = Math.max(5, footprint * 0.02);
  let levels = 0;
  let inRun = false;
  for (let i = 0; i < floorAreaByZ.length; i++) {
    const above = floorAreaByZ[i] >= threshold;
    if (above && !inRun) {
      levels++;
      inRun = true;
    } else if (!above) {
      inRun = false;
    }
  }
  return levels;
}

function axisProfileStats(values: number[] | undefined): { compression: number; smoothness: number } | null {
  if (!values || values.length < 4) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return null;
  const endSample = Math.max(1, Math.round(n * 0.2));
  const endsAvg =
    (values.slice(0, endSample).reduce((a, b) => a + b, 0) + values.slice(-endSample).reduce((a, b) => a + b, 0)) /
    (endSample * 2);
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
  const { metrics, config, tileFt } = tile;

  const facesReached = FACE_NAMES.filter((f) => (metrics.faces?.[f]?.open_area_ft2 ?? 0) >= OPEN_FACE_THRESHOLD_FT2);
  const totalOpenAreaFt2 =
    metrics.open_area_on_faces_ft2 ??
    FACE_NAMES.reduce((sum, f) => sum + (metrics.faces?.[f]?.open_area_ft2 ?? 0), 0);
  const topOpenAreaFt2 = metrics.faces?.["+Z"]?.open_area_ft2 ?? 0;

  const largestVoidFt3 = metrics.largest_void_ft3 ?? metrics.void_volume_ft3;
  const singlePieceFractionPct = metrics.void_volume_ft3 > 0 ? (100 * largestVoidFt3) / metrics.void_volume_ft3 : 100;

  const floorLevels = detectFloorLevels(metrics.floor_area_by_z_ft2, tileFt);

  const bboxSpan =
    metrics.void_bbox &&
    ([
      metrics.void_bbox.max_ft[0] - metrics.void_bbox.min_ft[0],
      metrics.void_bbox.max_ft[1] - metrics.void_bbox.min_ft[1],
      metrics.void_bbox.max_ft[2] - metrics.void_bbox.min_ft[2],
    ] as [number, number, number]);
  const elongationRatio = bboxSpan ? Math.max(...bboxSpan) / Math.max(Math.min(...bboxSpan), 0.5) : null;

  const profiles = metrics.void_area_profile_ft2;
  const candidates = [profiles?.x, profiles?.y, profiles?.z].map(axisProfileStats).filter((s): s is NonNullable<typeof s> => !!s);
  const mostCompressed = candidates.length ? candidates.reduce((a, b) => (b.compression < a.compression ? b : a)) : null;
  const smoothest = candidates.length ? candidates.reduce((a, b) => (b.smoothness > a.smoothness ? b : a)) : null;

  const zCentroidFrac = metrics.void_bbox && tileFt[2] > 0 ? metrics.void_bbox.centroid_ft[2] / tileFt[2] : null;

  return {
    voidFractionPct: metrics.void_fraction * 100,
    facesReached,
    facesReachedCount: facesReached.length,
    totalOpenAreaFt2,
    topOpenAreaFt2,
    voidPieces: metrics.void_pieces ?? 1,
    singlePieceFractionPct,
    floorLevels,
    verticalSpanFt: metrics.void_z_range_ft ? metrics.void_z_range_ft[1] - metrics.void_z_range_ft[0] : null,
    elongationRatio,
    graduatedSmoothness: smoothest?.smoothness ?? null,
    compressionRatio: mostCompressed?.compression ?? null,
    gravity: config.gravity ?? 0,
    drain: !!config.drain,
    layerStrength: config.foam?.layer_strength ?? 0,
    web: config.foam?.web ?? 0,
    largestVoidFt3,
    zCentroidFrac,
  };
}
