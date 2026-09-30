// Turns a loaded tile's geometry into a 1-100 score (plus a quantitative
// reading and a one-sentence verdict) for each of the 12 studio descriptors.
// Built from what the erosion engine already exports (tile.json's metrics +
// config, faces.json) -- see primitives.ts for the geometric quantities each
// one reads below.
//
// A few descriptors describe design intent rather than pure geometry
// (Threaded, Non-hierarchical Circulation, Force-driven); those are inferred
// from the closest geometric stand-in available (connectivity, opening
// count, dominant source dose) and flagged `approximate`. Every other
// descriptor is scored from a direct or lightly-derived measurement.

import type { ParsedTile } from "@/lib/types";
import { computePrimitives, type ScoringPrimitives } from "@/lib/scoring/primitives";
import { clamp, coefficientOfVariation, normalize, triangular } from "@/lib/scoring/utils";

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

type Def = { key: DescriptorKey; label: string; compute: (p: ScoringPrimitives) => Omit<DescriptorResult, "key" | "label"> };

const DEFS: Def[] = [
  {
    key: "carved",
    label: "Carved",
    compute: (p) => {
      // Reads best in a mid-range: too little void hasn't carved anything,
      // too much starts reading as a lattice rather than a solid mass with
      // something taken out of it. A single connected void, cut cleanly
      // (not left blocky from the voxel source), reinforces the reading;
      // resistant strata/webs reintroduce visible seams that work against it.
      const sweetSpot = triangular(p.voidFractionPct, 8, 27, 55);
      const pieceFactor = p.voidPieces === 1 ? 1 : p.voidPieces <= 3 ? 0.6 : 0.3;
      const seamlessness = clamp(1 - (1 - p.meshSmoothnessRatio) * 0.6, 0, 1);
      const penalty = (p.layered ? Math.min(30, p.layerCount * 6) : 0) + (p.webStrength > 0.05 ? Math.round(p.webStrength * 20) : 0);
      const score = sweetSpot * (0.55 + 0.25 * pieceFactor + 0.2 * seamlessness) - penalty;
      return {
        score,
        quantValue: `${p.voidFractionPct.toFixed(1)}% void, ${p.voidPieces} piece(s)`,
        quantCriterion: "share of the tile's volume removed as void, and how many separate pieces it split into",
        verdict: score < 35 ? "Lightly carved" : score < 65 ? "Carved" : "Heavily carved, reads as one mass",
        verdictCriterion: "void fraction weighted by single-piece continuity and surface seamlessness",
      };
    },
  },
  {
    key: "stepped",
    label: "Stepped",
    compute: (p) => {
      const levels = p.floorLevels.length;
      const avgArea = levels > 0 ? p.floorLevels.reduce((a, l) => a + l.areaFt2, 0) / levels : 0;
      const areaFactor = normalize(avgArea, 10, 80);
      const score = levels === 0 ? 0 : 0.7 * normalize(levels, 1, 5) + 0.3 * areaFactor;
      return {
        score,
        quantValue: levels === 0 ? "0 levels" : `${levels} level(s), ~${avgArea.toFixed(0)} ft² avg`,
        quantCriterion: "distinct horizontal floor plateaus detected in section, and their average area",
        verdict: levels === 0 ? "No stepping detected" : levels === 1 ? "One level, not stepped" : `${levels} distinct levels`,
        verdictCriterion: "count of z-layers with floor area above the noise floor, area-clustered with gap tolerance",
      };
    },
  },
  {
    key: "porous",
    label: "Porous",
    compute: (p) => {
      const score = 0.55 * clamp(p.porosityPct, 0, 100) + 0.3 * normalize(p.totalBranches, 0, 10) + 0.15 * normalize(p.facesReachedCount, 0, 6);
      return {
        score,
        quantValue: `${p.porosityPct.toFixed(0)}% of skin open, ${p.totalBranches} opening(s)`,
        quantCriterion: "open area as a share of the void's own total surface, and its count of distinct openings",
        verdict: score < 25 ? "Sealed / near-sealed" : score < 55 ? "Partially porous" : "Highly porous",
        verdictCriterion: "porosity ratio blended with the number of separate real openings across all 6 faces",
      };
    },
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
    compute: (p) => {
      const score = clamp(50 + p.layerStrength * 50 + (p.layered ? Math.min(20, p.layerCount * 5) : 0), 0, 100);
      return {
        score,
        quantValue: `layer ${p.layerStrength.toFixed(2)} (${p.layerCount}×), web ${p.webStrength.toFixed(2)}`,
        quantCriterion: "foam layer strength/count and membrane (web) setting from the recipe",
        verdict: p.layerStrength > 0.3 ? "Resistant sheet present" : p.layerStrength < -0.3 ? "Weak seam configured" : "No strong resistant layer",
        verdictCriterion: "recipe's layer_strength: positive = resistant, negative = weak seam, scaled by layer count",
      };
    },
  },
  {
    key: "threaded",
    label: "Threaded",
    compute: (p) => {
      const approximate = p.elongationRatio === null;
      const elongation = p.elongationRatio ?? 1;
      // A single continuous void that also has several distinct openings to
      // move between reads as more "threaded through" than an elongated but
      // otherwise sealed void.
      const score = approximate ? 0 : clamp(normalize(elongation, 1, 3) * 0.75 + normalize(p.totalBranches, 0, 6) * 0.25, 0, 100);
      return {
        score,
        quantValue: approximate ? "—" : `${elongation.toFixed(2)}× elongation, ${p.totalBranches} opening(s)`,
        quantCriterion: "longest void extent relative to its shortest, and its count of distinct openings",
        verdict: approximate
          ? "Not enough data"
          : score >= 65
            ? "Strongly threaded"
            : score >= 35
              ? "Moderately threaded"
              : "Compact, not threaded",
        verdictCriterion: "bounding-box elongation blended with opening count -- a corridor-like proxy, not true path analysis",
        approximate,
      };
    },
  },
  {
    key: "graduated",
    label: "Graduated",
    compute: (p) => {
      const approximate = p.verticalProfileFt2.filter((v) => v > 0).length < 4;
      const score = approximate ? 0 : p.graduatedSmoothness;
      return {
        score,
        quantValue: approximate ? "—" : `${score.toFixed(0)}/100 smoothness`,
        quantCriterion: "smoothness of the void's cross-sectional area from base to top",
        verdict: approximate
          ? "Not enough data"
          : score >= 70
            ? "Smooth graduated transition"
            : score >= 40
              ? "Somewhat graduated"
              : "Abrupt, not graduated",
        verdictCriterion: "step-to-step change in the void's vertical section-area profile",
        approximate,
      };
    },
  },
  {
    key: "nonHierarchical",
    label: "Non-hierarchical Circulation",
    compute: (p) => {
      // Real distinct openings (faceBranches), discounted when the void is
      // fragmented (upper reaches aren't actually all joined to the same
      // route), then how evenly-weighted those openings are -- several
      // similar-sized openings reads as non-hierarchical; one dominant one
      // among several small ones reads as a single main route instead.
      const continuity = p.voidPieces === 1 ? 1 : p.singlePieceFractionPct / 100;
      const access = p.totalBranches * continuity;
      const evenness = p.branchAreasFt2.length < 2 ? 0 : 1 - clamp(coefficientOfVariation(p.branchAreasFt2), 0, 1);
      const score = clamp(0.65 * normalize(access, 0, 8) + 0.35 * evenness * 100, 0, 100);
      return {
        score,
        quantValue: `${access.toFixed(1)} effective access points`,
        quantCriterion: "distinct openings reached, discounted if fragmented, weighted by how evenly-sized they are",
        verdict: score >= 60 ? "Multiple equal-weight access points" : score >= 30 ? "A couple of access routes" : "One dominant access route",
        verdictCriterion: "opening count and size evenness -- a proxy, not a true path-graph analysis",
        approximate: true,
      };
    },
  },
  {
    key: "forceDriven",
    label: "Force-driven",
    compute: (p) => {
      const score = clamp(normalize(p.gravity, 0, 1) * 0.6 + p.doseConcentration * 100 * 0.4, 0, 100);
      return {
        score,
        quantValue: `gravity ${p.gravity.toFixed(2)}${p.drain ? ", drain on" : ""}, "${p.dominantMode}" ${(p.doseConcentration * 100).toFixed(0)}% of dose`,
        quantCriterion: "the erosion recipe's gravity/drain settings and how concentrated its dose was in one dominant source",
        verdict: score >= 60 ? "Strongly force-driven" : score >= 25 ? "Moderately force-driven" : "Largely undirected",
        verdictCriterion: "gravity setting blended with dose concentration in the dominant source",
      };
    },
  },
  {
    key: "lightFilled",
    label: "Light-filled",
    compute: (p) => {
      const score = clamp(normalize(p.skylightPct, 0, 80) * 0.65 + normalize(p.topOpenAreaFt2, 0, 80) * 0.35, 0, 100);
      return {
        score,
        quantValue: `${p.topOpenAreaFt2.toFixed(0)} ft² overhead (${p.skylightPct.toFixed(0)}% of base floor)`,
        quantCriterion: "open area on the +Z (top) face, and that as a share of the floor it lights",
        verdict: score >= 55 ? "Strongly light-filled from above" : score >= 15 ? "Some overhead light" : "Little to no overhead opening",
        verdictCriterion: "top-face opening sized against the floor area it actually falls onto",
      };
    },
  },
  {
    key: "monumental",
    label: "Monumental",
    compute: (p) => {
      const score = clamp(normalize(p.heightToWidthRatio, 0.3, 2.2) * 0.5 + clamp(p.voidFractionPct, 0, 100) * 0.5, 0, 100);
      return {
        score,
        quantValue: `${p.voidHeightFt.toFixed(1)} ft tall, ${p.heightToWidthRatio.toFixed(2)}× height/width, ${p.largestVoidFt3.toFixed(0)} ft³`,
        quantCriterion: "the void's height-to-width proportion and its overall volume",
        verdict: score >= 60 ? "Reads as monumental within the 20 ft cube" : score >= 30 ? "Partial-scale volume" : "Compact, not monumental",
        verdictCriterion: "verticality (height/width ratio) blended with sheer void volume",
      };
    },
  },
  {
    key: "spatialDensity",
    label: "Spatial Density",
    compute: (p) => {
      const nz = p.sequenceProfileFt2.filter((v) => v > 0);
      const presence = nz.length ? Math.min(
        nz.filter((v) => v <= p.narrowestFt2 * 1.25).length / nz.length,
        nz.filter((v) => v >= p.widestFt2 * 0.75).length / nz.length,
      ) : 0;
      const score = clamp(100 * (1 - p.compressionRatio) * 0.75 + presence * 100 * 0.25, 0, 100);
      return {
        score,
        quantValue: `${p.sequenceAxis.toUpperCase()}: ${p.narrowestFt2.toFixed(0)}→${p.widestFt2.toFixed(0)} ft²`,
        quantCriterion: "how much narrower the void's midsection is than its widest moment, along its dominant axis",
        verdict: score >= 55 ? "Clear compression / release rhythm" : score >= 25 ? "Mild width variation" : "Roughly uniform, no compression",
        verdictCriterion: "mid-span vs. end-span area ratio, credited only if both a tight and open moment actually persist",
      };
    },
  },
];

export function scoreTile(tile: ParsedTile): DescriptorResult[] {
  const primitives = computePrimitives(tile);
  return DEFS.map((def) => {
    const computed = def.compute(primitives);
    return { key: def.key, label: def.label, ...computed, score: Math.round(clamp(computed.score, 0, 100)) };
  });
}
