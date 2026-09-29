import type { ParsedTile } from "@/lib/types";
import { computePrimitives, type ScoringPrimitives } from "@/lib/scoring/primitives";

export type DescriptorKey =
  | "carved" | "stepped" | "porous" | "continuous" | "resistant" | "threaded"
  | "graduated" | "nonHierarchical" | "forceDriven" | "lightFilled" | "monumental" | "spatialDensity";

export interface DescriptorResult {
  key: DescriptorKey;
  label: string;
  score: number; // 0-100, for sorting / bars
  quantValue: string;
  quantCriterion: string;
  verdict: string;
  verdictCriterion: string;
  /** true when the metrics this descriptor needs weren't present on the tile */
  approximate?: boolean;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const scale = (v: number, lo: number, hi: number) => clamp((100 * (v - lo)) / (hi - lo));

type Def = { key: DescriptorKey; label: string; compute: (p: ScoringPrimitives) => Omit<DescriptorResult, "key" | "label"> };

const DEFS: Def[] = [
  {
    key: "carved",
    label: "Carved",
    compute: (p) => ({
      score: scale(p.voidFractionPct, 0, 45),
      quantValue: `${p.voidFractionPct.toFixed(1)}%`,
      quantCriterion: "share of the tile's volume removed as void",
      verdict: p.voidFractionPct < 15 ? "Lightly carved" : p.voidFractionPct < 35 ? "Carved" : "Heavily carved",
      verdictCriterion: "void fraction relative to a lightly/heavily carved range (15% / 35%)",
    }),
  },
  {
    key: "stepped",
    label: "Stepped",
    compute: (p) => ({
      score: scale(p.floorLevels, 0, 4),
      quantValue: `${p.floorLevels}`,
      quantCriterion: "distinct horizontal floor plateaus detected in the void",
      verdict: p.floorLevels <= 1 ? "No stepping detected" : p.floorLevels === 2 ? "Two levels" : `${p.floorLevels} distinct levels`,
      verdictCriterion: "count of z-layers with floor area above 2% of the tile footprint",
    }),
  },
  {
    key: "porous",
    label: "Porous",
    compute: (p) => ({
      score: scale(p.facesReachedCount, 0, 6),
      quantValue: `${p.facesReachedCount}/6 faces, ${p.totalOpenAreaFt2.toFixed(0)} ft²`,
      quantCriterion: "faces with a real opening (≥ 8 ft²) and their combined area",
      verdict: p.facesReachedCount <= 1 ? "Sealed / near-sealed" : p.facesReachedCount <= 3 ? "Partially porous" : "Highly porous",
      verdictCriterion: "number of faces reached out of 6",
    }),
  },
  {
    key: "continuous",
    label: "Continuous",
    compute: (p) => ({
      score: p.singlePieceFractionPct,
      quantValue: `${p.singlePieceFractionPct.toFixed(1)}%`,
      quantCriterion: "share of the void volume in one connected piece",
      verdict:
        p.singlePieceFractionPct >= 98
          ? "Fully continuous"
          : p.singlePieceFractionPct >= 80
            ? "Mostly continuous"
            : `Fragmented into ${p.voidPieces} pieces`,
      verdictCriterion: "largest connected void piece vs. total void volume",
    }),
  },
  {
    key: "resistant",
    label: "Resistant",
    compute: (p) => ({
      score: scale(p.layerStrength, -1, 1),
      quantValue: `layer ${p.layerStrength.toFixed(2)}, web ${p.web.toFixed(2)}`,
      quantCriterion: "foam layer strength and membrane (web) setting from the recipe",
      verdict: p.layerStrength > 0.3 ? "Resistant sheet present" : p.layerStrength < -0.3 ? "Weak seam configured" : "No strong resistant layer",
      verdictCriterion: "recipe's layer_strength: positive = resistant, negative = weak seam",
    }),
  },
  {
    key: "threaded",
    label: "Threaded",
    compute: (p) => ({
      score: p.elongationRatio === null ? 0 : scale(p.elongationRatio, 1, 3),
      quantValue: p.elongationRatio === null ? "—" : `${p.elongationRatio.toFixed(2)}×`,
      quantCriterion: "longest void extent relative to its shortest (a corridor-like proxy)",
      verdict:
        p.elongationRatio === null
          ? "Not enough data"
          : p.elongationRatio > 2.2
            ? "Strongly threaded"
            : p.elongationRatio > 1.4
              ? "Moderately threaded"
              : "Compact, not threaded",
      verdictCriterion: "bounding-box elongation of the void",
      approximate: p.elongationRatio === null,
    }),
  },
  {
    key: "graduated",
    label: "Graduated",
    compute: (p) => ({
      score: p.graduatedSmoothness ?? 0,
      quantValue: p.graduatedSmoothness === null ? "—" : `${p.graduatedSmoothness.toFixed(0)}/100`,
      quantCriterion: "smoothness of the void's cross-sectional area along its dominant axis",
      verdict:
        p.graduatedSmoothness === null
          ? "Not enough data"
          : p.graduatedSmoothness >= 70
            ? "Smooth graduated transition"
            : p.graduatedSmoothness >= 40
              ? "Somewhat graduated"
              : "Abrupt, not graduated",
      verdictCriterion: "step-to-step change in the void's section-area profile",
      approximate: p.graduatedSmoothness === null,
    }),
  },
  {
    key: "nonHierarchical",
    label: "Non-hierarchical Circulation",
    compute: (p) => {
      const access = p.facesReachedCount * (p.voidPieces === 1 ? 1 : p.singlePieceFractionPct / 100);
      return {
        score: scale(access, 0, 6),
        quantValue: `${access.toFixed(1)} effective access points`,
        quantCriterion: "faces reached, discounted if the void is fragmented — a proxy, not a true path-graph analysis",
        verdict: access >= 4 ? "Multiple equal-weight access points" : access >= 2 ? "A couple of access routes" : "One dominant access route",
        verdictCriterion: "count of similarly-weighted openings into one connected void",
        approximate: true,
      };
    },
  },
  {
    key: "forceDriven",
    label: "Force-driven",
    compute: (p) => ({
      score: scale(p.gravity, 0, 1),
      quantValue: `gravity ${p.gravity.toFixed(2)}${p.drain ? ", drain on" : ""}`,
      quantCriterion: "the erosion recipe's gravity and drain settings",
      verdict: p.gravity >= 0.5 ? "Strongly gravity-driven" : p.gravity >= 0.15 ? "Moderately force-driven" : "Largely undirected (low gravity)",
      verdictCriterion: "gravity setting used to make the tile",
    }),
  },
  {
    key: "lightFilled",
    label: "Light-filled",
    compute: (p) => ({
      score: scale(p.topOpenAreaFt2, 0, 80),
      quantValue: `${p.topOpenAreaFt2.toFixed(0)} ft² overhead`,
      quantCriterion: "open area on the +Z (top) face",
      verdict: p.topOpenAreaFt2 >= 40 ? "Strongly light-filled from above" : p.topOpenAreaFt2 >= 8 ? "Some overhead light" : "Little to no overhead opening",
      verdictCriterion: "top-face opening vs. an 8 / 40 ft² range",
    }),
  },
  {
    key: "monumental",
    label: "Monumental",
    compute: (p) => ({
      score: p.verticalSpanFt === null ? 0 : scale(p.verticalSpanFt, 4, 20),
      quantValue: p.verticalSpanFt === null ? "—" : `${p.verticalSpanFt.toFixed(1)} ft tall, ${p.largestVoidFt3.toFixed(0)} ft³`,
      quantCriterion: "vertical extent of the void and its overall volume",
      verdict:
        p.verticalSpanFt === null
          ? "Not enough data"
          : p.verticalSpanFt >= 16
            ? "Full-height monumental void"
            : p.verticalSpanFt >= 8
              ? "Partial-height volume"
              : "Compact, not monumental",
      verdictCriterion: "void height vs. an 8 / 16 ft range",
      approximate: p.verticalSpanFt === null,
    }),
  },
  {
    key: "spatialDensity",
    label: "Spatial Density",
    compute: (p) => ({
      score: p.compressionRatio === null ? 0 : 100 * (1 - p.compressionRatio),
      quantValue: p.compressionRatio === null ? "—" : `${(p.compressionRatio * 100).toFixed(0)}% of end width at mid-span`,
      quantCriterion: "how much narrower the void's midsection is than its ends, along its dominant axis",
      verdict:
        p.compressionRatio === null
          ? "Not enough data"
          : p.compressionRatio < 0.5
            ? "Clear compression / release rhythm"
            : p.compressionRatio < 0.8
              ? "Mild width variation"
              : "Roughly uniform, no compression",
      verdictCriterion: "mid-span area vs. end area of the void's section profile",
      approximate: p.compressionRatio === null,
    }),
  },
];

export function scoreTile(tile: ParsedTile): DescriptorResult[] {
  const primitives = computePrimitives(tile);
  return DEFS.map((def) => ({ key: def.key, label: def.label, ...def.compute(primitives) }));
}
