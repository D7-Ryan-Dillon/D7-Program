// Reads a tile as a set of spaces against the twelve descriptors of Assignment 1 Part 3's matrix (lib/scoring/matrix.ts holds the matrix word for word;
// matrixEval.ts is the evaluation that follows it honestly, with a status and a method for every number). THIS file is the app's own 0-100 "presence index"
// for each descriptor: a blend of what the voxels show, kept for the bars, the carry-forward and the older boards. It is not the matrix measurement
// and is not shown as one. Each one comes
// back with the same five things:
//   score          0-100, for the bar and the project's carry-forward
//   quant          a headline value with units, and the measures behind it, each with how it was measured
//   qualitative    a reading on a named scale in experiential words, with its neighbours
//   drivers        the factors behind the score, each with its value and how well it did
//   explanation    one or two sentences about THIS tile's spaces, written from what was measured (never canned)
//   evidence       the rooms, levels or route the sentence talks about, so the views can light them
//
// Measured from the tile's spaces (levels, rooms, route, light, openings) and structure -- lib/tiles -- plus the recipe's
// settings for the one descriptor that is about how the tile was made (Force-driven). See measures.ts.

import { measuresFor, type Measures } from "@/lib/scoring/measures";
import { DEFAULT_ASSUMPTIONS } from "@/lib/scoring/assumptions";
import { matrixOf } from "@/lib/scoring/matrix";
import { spatialDensityFor } from "@/lib/scoring/spatialDensity";
import { clamp, coefficientOfVariation, normalize, triangular } from "@/lib/scoring/utils";
import { cap, count, countWord, fix, ft, ft2, ft3, levelHeights, list, num, numberWord, pct, roomShort, sentence } from "@/lib/scoring/words";
import type { ParsedTile } from "@/lib/types";

export type DescriptorKey =
  | "carved" | "stepped" | "porous" | "continuous" | "resistant" | "threaded"
  | "graduated" | "nonHierarchical" | "forceDriven" | "lightFilled" | "monumental" | "spatialDensity";

/** An older measurement kept as a legacy reading beside the twelve: the earlier Spatial density, which measured the void's cross-section AREA along the main route (a different formula from the matrix's passage-width ratio). */
export type LegacyKey = "spatialDensityArea";

export interface Driver {
  label: string;
  /** the measured value, in words */
  value: string;
  /** how well this factor did, 0-100 */
  pts: number;
  /** its share of the score */
  weight: number;
}

export interface QuantReading {
  headline: string;
  headlineHow: string;
  supporting: { label: string; value: string; how: string }[];
}

export interface QualitativeReading {
  /** the scale, lowest to highest */
  scale: string[];
  index: number;
  reading: string;
  how: string;
}

/** What a sentence talks about, for the Evidence button and the annotated diagrams. */
export interface Evidence {
  rooms?: number[];
  levels?: number[];
  /** the tile's main route (the engine's shortest way between two faces) */
  route?: boolean;
  /** a floor-supported route found for the matrix (tile coordinates, ft): drawn instead of the main route when present */
  routePoints?: number[][];
  /** boxes (tile coordinates, ft) to mark on plans and sections */
  regions?: { min: number[]; max: number[] }[];
}

export interface DescriptorResult {
  key: DescriptorKey;
  label: string;
  score: number;
  /** headline quantity (same as quant.headline) */
  quantValue: string;
  quantCriterion: string;
  /** the qualitative reading (same as qualitative.reading) */
  verdict: string;
  verdictCriterion: string;
  approximate?: boolean;
  quant: QuantReading;
  qualitative: QualitativeReading;
  drivers: Driver[];
  explanation: string;
  evidence: Evidence;
}

type Computed = Pick<DescriptorResult, "score" | "quant" | "qualitative" | "drivers" | "explanation" | "evidence"> & { approximate?: boolean };
type Def = { key: DescriptorKey | LegacyKey; label: string; compute: (m: Measures) => Computed };

const d = (label: string, value: string, pts: number, weight: number): Driver => ({ label, value, pts: clamp(pts, 0, 100), weight });
const blend = (ds: Driver[]) => {
  const w = ds.reduce((a, x) => a + x.weight, 0);
  return w > 0 ? ds.reduce((a, x) => a + x.pts * x.weight, 0) / w : 0;
};
const bin = (score: number) => (score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3);
const read = (scale: string[], index: number, how: string): QualitativeReading => ({ scale, index, reading: scale[index], how });

/** The factor that lifts the score most and the one that holds it back most (weighted distance from the score). */
export function topDrivers(drivers: Driver[], score: number): { lifts: Driver | null; holds: Driver | null } {
  let lifts: Driver | null = null;
  let holds: Driver | null = null;
  let best = 0;
  let worst = 0;
  for (const x of drivers) {
    const lift = (x.pts - score) * x.weight;
    if (lift > best) {
      best = lift;
      lifts = x;
    }
    if (lift < worst) {
      worst = lift;
      holds = x;
    }
  }
  return { lifts, holds };
}

const noData = (what: string): Computed => ({
  score: 0,
  quant: { headline: "—", headlineHow: what, supporting: [] },
  qualitative: read(["not measured"], 0, "needs the tile's voxel data"),
  drivers: [],
  explanation: `This tile carries no voxel data, so ${what} could not be measured.`,
  evidence: {},
});

const levelClear = (m: Measures) => m.levels.map((l) => l.clear_height_ft.mean);

const DEFS: Def[] = [
  // ------------------------------------------------------------------------------------------------ Carved
  {
    key: "carved",
    label: "Carved",
    compute: (m) => {
      const s = m.structure;
      const sweet = triangular(m.voidPct, 20, 58, 92);
      const foamOne = s.foam_pieces <= 1 ? 100 : s.main_piece_share * 100;
      const smooth = clamp(100 * (1 - (1 - m.prim.meshSmoothnessRatio) * 0.6), 0, 100);
      const seam = (m.prim.layered ? Math.min(30, m.prim.layerCount * 6) : 0) + (m.prim.webStrength > 0.05 ? Math.round(m.prim.webStrength * 20) : 0);
      const drivers = [
        d("Share removed", `${pct(m.voidPct / 100)} of the block`, sweet, 0.45),
        d("Foam as one body", s.foam_pieces <= 1 ? "one body" : `${s.foam_pieces} pieces`, foamOne, 0.2),
        d("Void as one volume", m.voidPieces <= 1 ? "one volume" : `${m.voidPieces} voids, ${pct(m.singlePiecePct / 100)} in the largest`, m.singlePiecePct, 0.2),
        d("Cut surface", m.prim.meshSmoothnessRatio < 1 ? `${pct(m.prim.meshSmoothnessRatio)} of the blocky voxel area` : "smooth", smooth, 0.1),
        d("Seams from layers or webs", seam ? "present" : "none", 100 - seam * 3, 0.05),
      ];
      const score = blend(drivers);
      const idx = m.voidPct < 35 ? 0 : m.voidPct < 65 ? 1 : m.voidPct < 82 ? 2 : 3;
      const tail = [
        "A light cut: the block still reads as a solid mass with a few spaces in it.",
        "A mass with space cut out of it: carved in the ordinary sense.",
        "So much is taken out that the foam reads as slabs and columns, a frame rather than a carved mass.",
        "Almost nothing is left of the block: a skeleton of foam.",
      ][idx];
      const foam = s.foam_pieces <= 1 ? "one continuous foam body" : `${s.foam_pieces} foam pieces`;
      const thin = s.thin_share["1"] ?? 0;
      return {
        score,
        quant: {
          headline: `${num(m.voidPct, 1)}% of the block removed`,
          headlineHow: "void volume as a share of the whole block",
          supporting: [
            { label: "Void", value: `${ft3(m.voidFt3)} in ${count(m.voidPieces, "piece")}`, how: "connected void pieces, counted in the voxels" },
            { label: "Largest void", value: `${ft3(m.largestVoidFt3)} (${pct(m.singlePiecePct / 100)} of the void)`, how: "the biggest connected piece against all void" },
            { label: "Foam left", value: `${ft3(s.foam_ft3)} in ${count(s.foam_pieces, "piece")}`, how: "separate foam bodies" },
            { label: "Thin foam", value: `${pct(thin, 1)} thinner than 1 ft`, how: "foam opened with a 1 ft ball; what does not survive is thin" },
          ],
        },
        qualitative: read(["lightly cut", "carved", "frame-like", "skeletal"], idx, "taken from the share of the block removed: under 35%, to 65%, to 82%, above"),
        drivers,
        explanation: sentence([
          `${pct(m.voidPct / 100)} of the block is removed${m.voidPieces <= 1 ? " as one connected volume" : `, divided into ${m.voidPieces} separate voids with ${pct(m.singlePiecePct / 100)} of it in the largest`}, leaving ${foam}${thin > 0.02 ? `, ${pct(thin)} of it thinner than 1 ft` : ""}.`,
          tail,
        ]),
        evidence: { rooms: m.rooms.slice(0, 1).map((r) => r.id) },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Stepped
  {
    key: "stepped",
    label: "Stepped",
    compute: (m) => {
      const lv = m.levels;
      if (!lv.length) {
        return {
          score: 0,
          quant: { headline: "0 levels", headlineHow: "floors found in the voxels (foam with void directly above)", supporting: [] },
          qualitative: read(["no floor", "single level", "split level", "stepped", "cascade"], 0, "by the number of levels"),
          drivers: [],
          explanation: "No floor is large enough to count as a level: the void has no flat or sloped surface to stand on, so nothing steps.",
          evidence: {},
        };
      }
      const zs = lv.map((l) => (l.kind === "flat" ? l.z_ft : (l.z_min_ft + l.z_max_ft) / 2));
      const rises = zs.slice(1).map((z, i) => z - zs[i]);
      const totalRise = zs.length > 1 ? zs[zs.length - 1] - zs[0] : 0;
      const tallestRise = rises.length ? Math.max(...rises) : 0;
      const areas = lv.map((l) => l.area_ft2);
      const biggest = lv.reduce((a, l) => (l.area_ft2 > a.area_ft2 ? l : a), lv[0]);
      const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
      const even = 1 - clamp(coefficientOfVariation(areas), 0, 1);
      const ramps = lv.filter((l) => l.kind === "sloped");
      const drivers = [
        d("Number of levels", `${lv.length} ${levelHeights(lv)}`, normalize(lv.length, 1, 5), 0.5),
        d("Total rise", `${ft(totalRise, 1)} from the lowest floor to the highest`, normalize(totalRise, 3, 14), 0.25),
        d("Evenness of floors", `floor areas from ${ft2(Math.min(...areas))} to ${ft2(Math.max(...areas))}`, even * 100, 0.15),
        d("Size of a floor", `${ft2(avgArea)} on average`, normalize(avgArea, 15, 120), 0.1),
      ];
      const score = blend(drivers);
      const n = lv.length;
      const idx = n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4;
      const scale = ["no floor", "single level", "split level", "stepped", "cascade"];
      const tail = [
        "",
        "The whole tile sits on one level, so it does not step.",
        "Two floors: a split level, with one change of height.",
        "Several floors one above the next: the tile steps.",
        "Many floors in a row: the tile cascades from level to level.",
      ][idx];
      return {
        score,
        quant: {
          headline: `${count(n, "level")} ${levelHeights(lv)}`,
          headlineHow: "floors found in the voxels (foam with void directly above), merged where layers touch",
          supporting: [
            { label: "Total rise", value: ft(totalRise, 1), how: "highest floor minus lowest floor" },
            { label: "Steepest single rise", value: rises.length ? ft(tallestRise, 1) : "none", how: "largest height change between neighbouring levels" },
            { label: "Largest floor", value: `${ft2(biggest.area_ft2)} (${biggest.name})`, how: "floor area per level, summed over its layers" },
            { label: "Ramps", value: ramps.length ? `${ramps.length}, e.g. ${ramps[0].name.replace(/^the /, "")}` : "none", how: "levels whose floor climbs over 1 ft" },
          ],
        },
        qualitative: read(scale, idx, "by the number of levels: one, two, three or four, five and more"),
        drivers,
        explanation: sentence([
          `${cap(countWord(n, "floor level"))} ${levelHeights(lv)}${ramps.length ? `, ${ramps.length === 1 ? "one of them a ramp" : `${ramps.length} of them ramps`}` : ""}${totalRise > 0 ? `, climbing ${ft(totalRise, 1)} in all with the steepest single rise ${ft(tallestRise, 1)}` : ""}; the largest floor is ${ft2(biggest.area_ft2)} (${biggest.name.replace(/^the /, "")}).`,
          tail,
        ]),
        evidence: { levels: lv.map((l) => l.id) },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Porous
  {
    key: "porous",
    label: "Porous",
    compute: (m) => {
      const faceCounts = Object.entries(m.openings).map(([f, o]) => ({ f, count: o.count, area: o.total_ft2 })).sort((a, b) => b.count - a.count || b.area - a.area);
      const best = faceCounts[0];
      const porosityPct = m.porosity * 100;
      const drivers = [
        d("Open share of the void's skin", `${pct(m.porosity)} (${ft2(m.openAreaFt2)} of ${ft2(m.skinFt2)})`, normalize(porosityPct, 0, 55), 0.5),
        d("Number of openings", `${count(m.openingCount, "opening")} on the faces`, normalize(m.openingCount, 0, 14), 0.3),
        d("Faces reached", `${m.facesReached.length} of 6`, normalize(m.facesReached.length, 0, 6), 0.2),
      ];
      const score = blend(drivers);
      const idx = bin(score);
      const tail = [
        "Nearly sealed: the voids keep to themselves.",
        "Perforated: a few openings let the voids reach outside.",
        "Porous: the void meets the outside in many places.",
        "An open frame: the faces are more opening than wall.",
      ][idx];
      return {
        score,
        quant: {
          headline: `${pct(m.porosity)} of the void's skin is open`,
          headlineHow: "open area on the six faces against the void's own surface",
          supporting: [
            { label: "Openings", value: `${m.openingCount} on ${m.facesReached.length} of 6 faces`, how: "connected void on a face, 4 ft² or more" },
            { label: "Open area", value: ft2(m.openAreaFt2), how: "summed over the six faces" },
            ...(best && best.count ? [{ label: "Busiest face", value: `${best.f}: ${count(best.count, "opening")}, ${ft2(best.area)}`, how: "face with the most openings" }] : []),
            { label: "Top face", value: ft2(m.openings["+Z"]?.total_ft2 ?? 0), how: "open area facing the sky" },
          ],
        },
        qualitative: read(["sealed", "perforated", "porous", "open frame"], idx, "by the score, which blends open share, opening count and faces reached"),
        drivers,
        explanation: sentence([
          `${count(m.openingCount, "opening")} reach${m.openingCount === 1 ? "es" : ""} ${m.facesReached.length} of the 6 faces${best && best.count > 1 ? ` (${best.f} most: ${best.count}, ${ft2(best.area)})` : ""}, and together they open ${pct(m.porosity)} of the void's skin.`,
          tail,
        ]),
        evidence: { rooms: m.spaces.graph.access_rooms },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Continuous
  {
    key: "continuous",
    label: "Continuous",
    compute: (m) => {
      const g = m.spaces.graph;
      const linked = g.rooms ? 1 - (g.components - 1) / Math.max(g.rooms, 1) : 1;
      const neck = g.neck_ft.min;
      const drivers = [
        d("Void in the largest piece", `${pct(m.singlePiecePct / 100)}${m.voidPieces > 1 ? `, ${m.voidPieces} pieces in all` : ""}`, m.singlePiecePct, 0.6),
        d("Rooms joined to each other", g.rooms ? `${g.rooms} room${g.rooms === 1 ? "" : "s"} in ${count(g.components, "group")}` : "no rooms", linked * 100, 0.25),
        ...(neck !== null ? [d("Narrowest neck between rooms", ft(neck, 1), normalize(neck, 2, 8), 0.15)] : []),
      ];
      const score = blend(drivers);
      const idx = score < 30 ? 0 : score < 60 ? 1 : score < 85 ? 2 : 3;
      const biggest = m.rooms[0];
      return {
        score,
        quant: {
          headline: `${pct(m.singlePiecePct / 100)} of the void in one piece`,
          headlineHow: "largest connected void piece against all void",
          supporting: [
            { label: "Void pieces", value: String(m.voidPieces), how: "connected pieces of void" },
            { label: "Rooms", value: `${g.rooms} in ${count(g.components, "group")}`, how: "the void split at its necks" },
            { label: "Openings between rooms", value: String(g.connections), how: "a neck 2 ft wide and 8 ft² or more" },
            { label: "Narrowest neck", value: neck !== null ? ft(neck, 1) : "none", how: "smallest opening that joins two rooms" },
          ],
        },
        qualitative: read(["fragmented", "linked", "continuous", "one space"], idx, "by the score, which blends the largest piece, how the rooms join and the narrowest neck"),
        drivers,
        explanation:
          (m.voidPieces <= 1 ? "The void is one piece" : `The void breaks into ${m.voidPieces} pieces, ${pct(m.singlePiecePct / 100)} of it in the largest${biggest ? ` (the ${roomShort(biggest)}, ${ft3(biggest.volume_ft3)})` : ""}`) +
          (g.rooms > 1
            ? g.connections
              ? `, and its ${g.rooms} rooms are joined by ${count(g.connections, "opening")}${neck !== null ? ` no narrower than ${ft(neck, 1)}` : ""}.`
              : `, and its ${g.rooms} rooms are not joined to each other inside the tile: they meet only through its faces.`
            : g.rooms === 1
              ? ", reading as a single room."
              : "."),
        evidence: { rooms: m.rooms.map((r) => r.id) },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Resistant
  {
    key: "resistant",
    label: "Resistant",
    compute: (m) => {
      const s = m.structure;
      const plates = s.plates;
      const thin = s.thin_share["1.5"] ?? 0;
      const grounded = plates.length ? plates.filter((p) => p.grounded).length / plates.length : 1;
      const plateArea = plates.reduce((a, p) => a + p.area_ft2, 0);
      const resPts = m.plateResistance === null ? 50 : normalize(m.plateResistance, 0.5, 3);
      const layerPts = clamp(50 + m.prim.layerStrength * 50 + (m.prim.layered ? Math.min(20, m.prim.layerCount * 5) : 0), 0, 100);
      const drivers = plates.length
        ? [
            d("Foam held by plates", `${pct(s.plate_share)} of the foam is flat structure`, normalize(s.plate_share * 100, 0, 30), 0.4),
            d("Plates joined to the ground", `${plates.filter((p) => p.grounded).length} of ${plates.length}`, grounded * 100, 0.2),
            d("Thin foam", `${pct(thin, 1)} thinner than 1.5 ft`, 100 - thin * 400, 0.2),
            d("Plate resistance", m.plateResistance === null ? "not recorded" : `${num(m.plateResistance, 1)}× the foam`, resPts, 0.2),
          ]
        : [
            d("Thin foam", `${pct(thin, 1)} thinner than 1.5 ft`, 100 - thin * 400, 0.4),
            d("Foam as one body", s.foam_pieces <= 1 ? "one body" : `${s.foam_pieces} pieces`, s.main_piece_share * 100, 0.3),
            d("Resistant layers in the recipe", m.prim.layered ? `${m.prim.layerCount} layers, strength ${num(m.prim.layerStrength, 2)}` : "none", layerPts, 0.3),
          ];
      const score = blend(drivers);
      const idx = bin(score);
      const loose = plates.filter((p) => !p.grounded).length;
      const resistant = plates.length
        ? `${cap(countWord(plates.length, "floor plate"))} (${ft2(plateArea)}) carry ${pct(s.plate_share)} of the foam as flat structure, ${loose === 0 ? "every one joined to the foam body that sits on the ground" : `${loose} of them not joined to the grounded body`}; ${pct(thin, 1)} of the foam is thinner than 1.5 ft.`
        : `There are no floor plates, so the foam is held only by what the erosion left; ${pct(thin, 1)} of it is thinner than 1.5 ft.`;
      return {
        score,
        quant: {
          headline: plates.length ? `${pct(s.plate_share)} of the foam is plates` : "no designed structure",
          headlineHow: "cells of floor plates and branches against all foam",
          supporting: [
            { label: "Plates", value: plates.length ? `${plates.length}, ${ft2(plateArea)}` : "none", how: "floor plates in the tile" },
            { label: "Joined to the ground", value: plates.length ? `${plates.filter((p) => p.grounded).length} of ${plates.length}` : "n/a", how: "plate in the same foam body as the bottom face" },
            { label: "Branches", value: ft3(s.branches_ft3), how: "support struts the engine grew" },
            { label: "Thin foam", value: `${pct(thin, 1)} under 1.5 ft`, how: "foam that does not survive opening with a 1.5 ft ball" },
            { label: "Plate resistance", value: m.plateResistance === null ? "not recorded" : `${num(m.plateResistance, 1)}× the foam`, how: "set per plate group in the recipe" },
          ],
        },
        qualitative: read(["soft", "layered", "braced", "rigid frame"], idx, "by the score, which blends plate share, grounding, thin foam and plate resistance"),
        drivers,
        explanation: resistant,
        evidence: { levels: m.levels.filter((l) => l.plate_ids.length).map((l) => l.id) },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Threaded
  {
    key: "threaded",
    label: "Threaded",
    compute: (m) => {
      const r = m.route;
      const pairs = m.routes.length;
      if (!r) {
        return {
          score: 0,
          quant: { headline: "no route", headlineHow: "shortest way through the void between two side faces", supporting: [{ label: "Linked face pairs", value: "0 of 6", how: "pairs of side faces joined through the void" }] },
          qualitative: read(["compact", "linear", "threaded", "labyrinthine"], 0, "by the score, which blends sinuosity, bends, route length and linked faces"),
          drivers: [],
          explanation: "No unbroken route through the void joins two side faces, so nothing can be threaded from one face to another.",
          evidence: {},
        };
      }
      const roomsOn = r.rooms.map((id) => m.rooms.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
      const width = Math.max(m.tile.tileFt[0], m.tile.tileFt[1]);
      const drivers = [
        d("Winding", `${fix(r.sinuosity)}× the straight distance`, normalize(r.sinuosity, 1, 1.6), 0.4),
        d("Bends", count(r.bends, "bend"), normalize(r.bends, 0, 4), 0.2),
        d("Length of the route", `${ft(r.length_ft)} across a ${ft(width)} tile`, normalize(r.length_ft / width, 1, 2), 0.2),
        d("Faces linked", `${pairs} of 6 pairs`, normalize(pairs, 0, 6), 0.2),
      ];
      const score = blend(drivers);
      const idx = bin(score);
      return {
        score,
        quant: {
          headline: `${ft(r.length_ft)} from ${r.from} to ${r.to}`,
          headlineHow: "shortest way through the void between the two side faces that are farthest apart by that route",
          supporting: [
            { label: "Winding", value: `${fix(r.sinuosity)}× the straight ${ft(r.straight_ft)}`, how: "route length over the straight distance between its ends" },
            { label: "Bends", value: String(r.bends), how: "turns over 35° on points 3 ft apart" },
            { label: "Rooms on the way", value: roomsOn.length ? list(roomsOn.map(roomShort)) : "none", how: "rooms the route passes through" },
            { label: "Linked face pairs", value: `${pairs} of 6`, how: "pairs of side faces joined through the void" },
          ],
        },
        qualitative: read(["compact", "linear", "threaded", "labyrinthine"], idx, "by the score, which blends winding, bends, route length and linked faces"),
        drivers,
        explanation: sentence([
          `The shortest way from ${r.from} to ${r.to} runs ${ft(r.length_ft)} through the void, ${fix(r.sinuosity)}× the straight ${ft(r.straight_ft)}, with ${count(r.bends, "bend")}${roomsOn.length ? ` through ${list(roomsOn.map((x) => `the ${roomShort(x)}`))}` : ""}.`,
          pairs === 6 ? "All six pairs of side faces are joined by a way like this." : pairs > 1 ? `${cap(numberWord(pairs))} of the 6 pairs of side faces are joined by a way like this.` : "No other pair of faces is joined through the void.",
        ]),
        evidence: { route: true, rooms: r.rooms },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Graduated
  {
    key: "graduated",
    label: "Graduated",
    compute: (m) => {
      const p = m.profile;
      const vals = p ? p.area_ft2.filter((v) => v > 0) : [];
      let smooth = 0;
      let jump = 0;
      if (vals.length >= 4) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const steps = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
        jump = Math.max(...steps);
        const rough = steps.reduce((a, b) => a + b, 0) / steps.length;
        smooth = 100 * (1 - Math.min(1, rough / Math.max(mean * 0.35, 1e-6)));
      }
      const clear = levelClear(m);
      const lo = clear.length ? Math.min(...clear) : 0;
      const hi = clear.length ? Math.max(...clear) : 0;
      const range = hi - lo;
      const sorted = [...m.levels].sort((a, b) => a.z_ft - b.z_ft).map((l) => l.clear_height_ft.mean);
      const maxStep = sorted.length > 1 ? Math.max(...sorted.slice(1).map((v, i) => Math.abs(v - sorted[i]))) : 0;
      const gradient = clear.length >= 2 ? normalize(range, 0.5, 8) * (1 - 0.5 * Math.min(1, maxStep / Math.max(range, 0.1))) : 0;
      const drivers = [
        d("Smoothness along the route", vals.length >= 4 ? `steepest change ${num(jump)} ft² per foot` : "no route to read", smooth, clear.length >= 2 ? 0.6 : 1),
        ...(clear.length >= 2 ? [d("Change of clear height between floors", `${ft(lo)} to ${ft(hi)} clear`, gradient, 0.4)] : []),
      ];
      const score = blend(drivers);
      const idx = score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3;
      return {
        score,
        approximate: vals.length < 4,
        quant: {
          headline: vals.length >= 4 ? `${num(smooth)}/100 smooth along the route` : "no route to read",
          headlineHow: "step-to-step change of the void's cross-section along the main route",
          supporting: [
            ...(p ? [{ label: "Cross-section", value: `${num(p.max_ft2)} to ${num(p.min_ft2)} ft² along ${p.axis.toUpperCase()}`, how: "void area per slice, rooms on the route only" }] : []),
            { label: "Steepest change", value: vals.length >= 4 ? `${num(jump)} ft² between neighbouring slices` : "n/a", how: "largest slice-to-slice jump" },
            { label: "Clear heights", value: clear.length ? `${ft(lo, 1)} to ${ft(hi, 1)} across ${count(clear.length, "floor")}` : "n/a", how: "mean clear height above each level's floor" },
            { label: "Biggest height step", value: sorted.length > 1 ? ft(maxStep, 1) : "n/a", how: "between neighbouring levels" },
          ],
        },
        qualitative: read(["abrupt", "stepwise", "graded", "smoothly graded"], idx, "by the score, which blends how smoothly the cross-section changes and how clear height changes between floors"),
        drivers,
        explanation: sentence([
          vals.length >= 4 && p
            ? `Along its main route the void's cross-section runs from ${num(p.max_ft2)} to ${num(p.min_ft2)} ft² ${smooth >= 60 ? "in a smooth gradient" : smooth >= 35 ? "in noticeable steps" : "in abrupt jumps"}, its steepest change ${num(jump)} ft² between neighbouring feet.`
            : "There is no route through the void to read a gradient along.",
          clear.length >= 2 ? `Clear height changes from ${ft(lo, 1)} to ${ft(hi, 1)} across its ${count(clear.length, "floor")}${maxStep > 0.6 * range && range > 1 ? ", mostly in one step" : ", gradually"}.` : clear.length === 1 ? `Its one floor has ${ft(lo, 1)} of clear height.` : "",
        ]),
        evidence: { route: true, rooms: m.route?.rooms },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Non-hierarchical circulation
  {
    key: "nonHierarchical",
    label: "Non-hierarchical Circulation",
    compute: (m) => {
      const pairs = m.routes.length;
      const areas = m.sideAreas;
      const access = areas.length * (m.voidPieces <= 1 ? 1 : m.singlePiecePct / 100);
      const evenness = areas.length < 2 ? 0 : 1 - clamp(coefficientOfVariation(areas), 0, 1);
      const g = m.spaces.graph;
      const biggestShare = areas.length ? areas[0] / areas.reduce((a, b) => a + b, 0) : 0;
      const drivers = [
        d("Faces joined through the void", `${pairs} of 6 pairs`, normalize(pairs, 0, 6), 0.35),
        d("Openings on the sides", `${count(areas.length, "opening")}${m.voidPieces > 1 ? ", discounted for a fragmented void" : ""}`, normalize(access, 0, 8), 0.3),
        d("Evenness of the openings", areas.length > 1 ? `${ft2(areas[areas.length - 1])} to ${ft2(areas[0])}` : "one or none", evenness * 100, 0.2),
        d("Loops between rooms", g.rooms > 1 ? `${count(g.loops, "loop")} among ${g.rooms} rooms` : "one room", normalize(g.loops, 0, 3), 0.15),
      ];
      const score = blend(drivers);
      const idx = score < 20 ? 0 : score < 45 ? 1 : score < 70 ? 2 : 3;
      return {
        score,
        quant: {
          headline: `${pairs} of 6 face pairs joined, ${count(areas.length, "side opening")}`,
          headlineHow: "pairs of side faces with a route through the void, and openings on the four side faces",
          supporting: [
            { label: "Side openings", value: areas.length ? `${areas.length}, ${ft2(areas[areas.length - 1])} to ${ft2(areas[0])}` : "none", how: "connected void on ±X and ±Y faces, 4 ft² or more" },
            { label: "Evenness", value: areas.length > 1 ? pct(evenness) : "n/a", how: "1 minus the spread of the opening sizes" },
            { label: "Largest opening's share", value: areas.length ? pct(biggestShare) : "n/a", how: "biggest side opening over all side opening area" },
            { label: "Loops", value: g.rooms > 1 ? String(g.loops) : "n/a", how: "independent circuits in the graph of rooms" },
          ],
        },
        qualitative: read(["single spine", "branched", "networked", "fully non-hierarchical"], idx, "by the score, which blends linked faces, openings, their evenness and loops"),
        drivers,
        explanation: sentence([
          pairs
            ? `${pairs === 6 ? "All six pairs" : `${cap(numberWord(pairs))} of the 6 pairs`} of faces ${pairs === 1 ? "is" : "are"} joined through the void, by ${count(areas.length, "opening")} on the sides${areas.length > 1 ? ` from ${ft2(areas[areas.length - 1])} to ${ft2(areas[0])}` : ""}.`
            : `No pair of faces is joined through the void; ${count(areas.length, "opening")} on the sides lead nowhere through.`,
          areas.length > 1 ? (biggestShare > 0.5 ? `One opening takes ${pct(biggestShare)} of the opening area, so it works as the main way in.` : "No single opening dominates, so no route is the obvious main one.") : "",
          g.loops > 0 ? `Its rooms form ${count(g.loops, "loop")}.` : "",
        ]),
        evidence: { route: true, rooms: m.spaces.graph.access_rooms },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Force-driven
  {
    key: "forceDriven",
    label: "Force-driven",
    compute: (m) => {
      if (!m.hasRecipe) {
        return {
          score: 0,
          approximate: true,
          quant: { headline: "no recipe", headlineHow: "the erosion recipe's gravity, drain, doses and plate behaviour", supporting: [] },
          qualitative: read(["undirected", "directed", "strongly driven", "forced"], 0, "needs the erosion recipe"),
          drivers: [],
          explanation: "This tile carries no erosion recipe (it was lofted or imported without one), so the forces that shaped it cannot be read.",
          evidence: {},
        };
      }
      const p = m.prim;
      const total = m.sources.reduce((a, s) => a + s.dose, 0);
      const top = m.sources.reduce((a, s) => (s.dose > a.dose ? s : a), m.sources[0]);
      const share = total > 0 ? top.dose / total : 0;
      const behaving = m.sources.filter((s) => s.plateMode !== "pool" || s.cut);
      const modes = [...new Set(m.sources.map((s) => s.plateMode + (s.cut ? " + cut" : "")))];
      const drivers = [
        d("Gravity", `${num(p.gravity, 2)}${p.drain ? ", with a drain" : ""}`, normalize(p.gravity, 0, 1), 0.4),
        d("Dose in the strongest source", `${pct(share)} of ${num(total)} ft³ in the ${top.mode} source`, share * 100, 0.3),
        d("Plates steered", behaving.length ? `${behaving.length} of ${m.sources.length} sources steer or cut the plates` : "every source lets solvent pool on plates", (behaving.length / m.sources.length) * 100, 0.2),
        d("Drain", p.drain ? "on" : "off", p.drain ? 100 : 0, 0.1),
      ];
      const score = blend(drivers);
      const idx = score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3;
      return {
        score,
        quant: {
          headline: `gravity ${num(p.gravity, 2)}, ${pct(share)} of the dose in one source`,
          headlineHow: "the recipe's gravity and how concentrated its dose is in the strongest source",
          supporting: [
            { label: "Sources", value: `${m.sources.length}, ${num(total)} ft³ of dose`, how: "erosion sources in the recipe" },
            { label: "Drain", value: p.drain ? "on" : "off", how: "solvent leaves through the bottom, or pools there" },
            { label: "Plate behaviour", value: list(modes), how: "how each source treats the floor plates (pool, stop, around, through, cut)" },
            { label: "Seed", value: String(m.tile.config.seed ?? "n/a"), how: "random seed of the foam and sources" },
          ],
        },
        qualitative: read(["undirected", "directed", "strongly driven", "forced"], idx, "by the score, which blends gravity, dose concentration, plate steering and drain"),
        drivers,
        explanation: sentence([
          `Gravity ${num(p.gravity, 2)} ${p.gravity >= 0.35 ? "pulls the solvent down, so it settles and spreads along each floor" : "hardly directs the solvent, so it spreads where it is placed"}${p.drain ? ", and a drain lets it fall out of the bottom" : ""}.`,
          `The strongest of ${count(m.sources.length, "source")} (${top.mode}) delivers ${pct(share)} of the dose${behaving.length ? `; ${count(behaving.length, "source")} steer${behaving.length === 1 ? "s" : ""} the plates (${list(modes.filter((x) => x !== "pool"))})` : ""}.`,
        ]),
        evidence: {},
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Light-filled
  {
    key: "lightFilled",
    label: "Light-filled",
    compute: (m) => {
      const day = m.spaces.daylight;
      const dark = m.levels.length ? m.levels.reduce((a, l) => (l.lit_fraction < a.lit_fraction ? l : a), m.levels[0]) : null;
      const darkRoom = m.rooms.length ? m.rooms.reduce((a, r) => (r.lit_fraction < a.lit_fraction && r.floor_area_ft2 > 30 ? r : a), m.rooms[0]) : null;
      const drivers = [
        d("Floor under open sky", `${pct(day.sky_floor_fraction)} of the floor`, day.sky_floor_fraction * 100, 0.5),
        d(`Floor within ${num(day.lit_within_ft)} ft of light`, `${pct(day.lit_floor_fraction)} of the floor`, day.lit_floor_fraction * 100, 0.3),
        d("Distance to light", `${ft(day.mean_light_distance_ft, 1)} on average`, 100 - normalize(day.mean_light_distance_ft, 0, 8), 0.2),
      ];
      const score = blend(drivers);
      const idx = score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3;
      const top = m.openings["+Z"]?.total_ft2 ?? 0;
      return {
        score,
        quant: {
          headline: `${pct(day.sky_floor_fraction)} of the floor under open sky`,
          headlineHow: "floor cells with void straight up to the open top",
          supporting: [
            { label: `Within ${num(day.lit_within_ft)} ft of light`, value: pct(day.lit_floor_fraction), how: "open sky above, or an open side face, reached through the void of the same layer" },
            { label: "Distance to light", value: `${ft(day.mean_light_distance_ft, 1)} mean`, how: "from floor cells to the nearest light, capped at 20 ft" },
            { label: "Top opening", value: ft2(top), how: "void open on the +Z face" },
            ...(dark ? [{ label: "Darkest floor", value: `${dark.name.replace(/^the /, "")}, ${pct(dark.lit_fraction)} lit`, how: "level with the smallest lit share" }] : []),
          ],
        },
        qualitative: read(["enclosed", "side-lit", "top-lit", "flooded with light"], idx, "by the score, which blends sky exposure, floor near light and distance to light"),
        drivers,
        explanation: sentence([
          `${pct(day.sky_floor_fraction)} of the floor sits under open sky and ${pct(day.lit_floor_fraction)} lies within ${num(day.lit_within_ft)} ft of light, ${ft(day.mean_light_distance_ft, 1)} from it on average.`,
          dark && dark.lit_fraction < 0.9 ? `The darkest floor is ${dark.name} (${pct(dark.lit_fraction)} lit)${darkRoom && darkRoom.lit_fraction < 0.9 ? `, in the ${roomShort(darkRoom)}` : ""}.` : m.levels.length > 1 ? "Every floor has light within reach." : "",
        ]),
        evidence: { levels: dark && dark.lit_fraction < 0.9 ? [dark.id] : m.levels.map((l) => l.id), rooms: darkRoom && darkRoom.lit_fraction < 0.9 ? [darkRoom.id] : undefined },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Monumental
  {
    key: "monumental",
    label: "Monumental",
    compute: (m) => {
      const t = m.tallest;
      const biggest = m.rooms[0];
      const share = biggest ? biggest.volume_share : 0;
      const drivers = [
        d("Clear height", `${ft(t.clearFt, 1)} clear (an ordinary ceiling is 8 ft)`, normalize(t.clearFt, 8, 20), 0.4),
        d("Height to width", `${num(t.ratio, 2)} (${ft(t.clearFt, 1)} over ${ft(t.widthFt, 1)})`, normalize(t.ratio, 0.3, 1.5), 0.3),
        d("Share held by the largest room", biggest ? `${pct(share)} of the void in the ${roomShort(biggest)}` : "no rooms", normalize(share * 100, 20, 80), 0.3),
      ];
      const score = blend(drivers);
      const idx = bin(score);
      const tail = [
        "At this scale it feels intimate, close to the body.",
        "Generous without being large: roomy rather than grand.",
        "Grand: the volume is clearly bigger than the human scale of the rest.",
        "Monumental: one dominant volume far above ordinary ceiling height.",
      ][idx];
      return {
        score,
        quant: {
          headline: `${ft(t.clearFt, 1)} tall over ${ft(t.widthFt, 1)}`,
          headlineHow: "clear height of the tallest room and its narrower horizontal extent",
          supporting: [
            { label: "Height to width", value: num(t.ratio, 2), how: "tallest clear height over that room's width" },
            { label: "Against an 8 ft ceiling", value: `${num(t.clearFt / 8, 1)}×`, how: "clear height over an ordinary storey" },
            { label: "Largest room", value: biggest ? `${ft3(biggest.volume_ft3)}, ${pct(share)} of the void` : "none", how: "room volume and its share of all void" },
            { label: "Clear heights by floor", value: m.levels.length ? `${ft(Math.min(...levelClear(m)), 1)} to ${ft(Math.max(...levelClear(m)), 1)}` : "n/a", how: "mean clear height above each level's floor" },
          ],
        },
        qualitative: read(["intimate", "generous", "grand", "monumental"], idx, "by the score, which blends clear height, proportion and the largest room's share"),
        drivers,
        explanation: sentence([
          t.room
            ? `The tallest space is the ${t.room.name}: ${ft(t.clearFt, 1)} clear over ${ft(t.widthFt, 1)} across, ${fix(t.ratio)}× as tall as wide and ${fix(t.clearFt / 8, 1)}× an ordinary 8 ft ceiling.`
            : `The tallest clear height is ${ft(t.clearFt, 1)}.`,
          biggest ? `The largest room holds ${pct(share)} of the void. ${tail}` : tail,
        ]),
        evidence: { rooms: t.room ? [t.room.id] : [] },
      };
    },
  },

  // ------------------------------------------------------------------------------------------------ Spatial density
  {
    key: "spatialDensity",
    label: "Spatial density",
    compute: (m) => {
      const r = spatialDensityFor(m.tile, DEFAULT_ASSUMPTIONS);
      if (!r.ok) {
        return {
          score: 0,
          approximate: true,
          quant: { headline: "no passage to read", headlineHow: "narrowest over widest clear passage width along a floor-supported route", supporting: [] },
          qualitative: read(["not assessable"], 0, "needs a floor-supported route from an opening"),
          drivers: [],
          explanation: r.reason,
          evidence: {},
        };
      }
      const p = r.profile;
      const contrast = 1 - p.ratio;
      const both = p.releases > 0;
      const drivers = [
        d("Contrast of widths", `narrowest ${ft(p.narrowFt, 1)} against widest ${ft(p.wideFt, 1)} (${num(p.ratio, 2)})`, normalize(contrast * 100, 10, 70), 0.6),
        d("A squeeze followed by a release", both ? `${count(p.releases, "release")}` : "no squeeze followed by a wider stretch", both ? 100 : 20, 0.4),
      ];
      const score = blend(drivers);
      const idx = p.ratio >= 0.8 ? 0 : p.ratio >= 0.55 ? 1 : p.ratio >= 0.35 ? 2 : 3;
      return {
        score,
        quant: {
          headline: `narrowest ${ft(p.narrowFt, 1)} to widest ${ft(p.wideFt, 1)} (${num(p.ratio, 2)})`,
          headlineHow: "smoothed clear width of the passage along a floor-supported route from a ground-level opening",
          supporting: [
            { label: "Route", value: ft(p.route.lengthFt), how: "floor-supported path from the entry to the destination" },
            { label: "Typical width", value: ft(p.typicalFt, 1), how: "median of the smoothed widths" },
            { label: "Constrictions", value: String(p.stretches.filter((x) => x.kind === "constriction").length), how: "stretches of 2 ft or more narrower than 0.6 of the typical width" },
            { label: "Expansions", value: String(p.stretches.filter((x) => x.kind === "expansion").length), how: "stretches of 2 ft or more wider than 1.4 times the typical width" },
          ],
        },
        qualitative: read(["little contrast", "gentle contrast", "marked contrast", "sharp contrast"], idx, "by the narrowest-to-widest ratio: over 0.8, to 0.55, to 0.35, below"),
        drivers,
        explanation: sentence([
          `Along a ${ft(p.route.lengthFt)} route from the entry, the clear passage runs from ${ft(p.narrowFt, 1)} at its narrowest to ${ft(p.wideFt, 1)} at its widest (${num(p.ratio, 2)}).`,
          both ? `${cap(countWord(p.releases, "squeeze"))} is followed by a wider stretch.` : "No narrow stretch is followed by a clearly wider one.",
        ]),
        evidence: { routePoints: p.route.points },
      };
    },
  },
];

/**
 * The earlier Spatial density: how much the void's cross-section AREA narrows along the engine's main route. The project's Spatial density is the
 * matrix's passage-width ratio (above); this older formula measured something else, so its numbers are kept as a LEGACY measurement, labelled as
 * such, and are never relabelled as the current criterion or mixed into it. The current criterion is always recomputed from the passage widths.
 */
const LEGACY: Def[] = [
  {
    key: "spatialDensityArea",
    label: "Spatial density, earlier cross-section formula",
    compute: (m) => {
      const p = m.profile;
      const clear = levelClear(m);
      const cr = clear.length >= 2 ? Math.max(...clear) / Math.max(Math.min(...clear), 0.5) : 1;
      if (!p || p.min_ft2 <= 0) {
        return {
          score: 0,
          approximate: true,
          quant: { headline: "no route to read", headlineHow: "cross-section along the main route", supporting: [] },
          qualitative: read(["uniform", "gently varied", "rhythmic", "sharply compressed"], 0, "needs a route through the void"),
          drivers: [],
          explanation: "There is no route through the void, so there is no sequence of tight and open moments to read.",
          evidence: {},
        };
      }
      const compression = 1 - p.min_ft2 / p.max_ft2;
      const vals = p.area_ft2.filter((v) => v > 0);
      const tight = vals.filter((v) => v <= p.min_ft2 * 1.25).length / vals.length;
      const open = vals.filter((v) => v >= p.max_ft2 * 0.75).length / vals.length;
      const presence = Math.min(tight, open) * 100;
      const drivers = [
        d("Compression", `${num(p.max_ft2)} down to ${num(p.min_ft2)} ft² (${num(p.ratio, 1)}:1)`, normalize(compression * 100, 20, 85), 0.5),
        d("Distinct squeezes", count(p.squeezes, "squeeze"), normalize(p.squeezes, 0, 2), 0.2),
        d("Both a tight and an open stretch", `${pct(tight)} tight, ${pct(open)} open`, normalize(presence, 0, 35), 0.15),
        d("Clear height between floors", clear.length >= 2 ? `${num(cr, 1)}:1` : "one floor", normalize(cr, 1, 2.5), 0.15),
      ];
      const score = blend(drivers);
      const idx = score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3;
      return {
        score,
        quant: {
          headline: `${num(p.max_ft2)} to ${num(p.min_ft2)} ft² along ${p.axis.toUpperCase()}`,
          headlineHow: "void cross-section along the main route, widest and narrowest slice",
          supporting: [
            { label: "Compression", value: `${num(p.ratio, 1)}:1`, how: "widest slice over narrowest" },
            { label: "Squeezes", value: String(p.squeezes), how: "stretches narrower than 60% of the typical slice" },
            { label: "Tight stretch", value: pct(tight), how: "slices within 25% of the narrowest" },
            { label: "Open stretch", value: pct(open), how: "slices within 25% of the widest" },
          ],
        },
        qualitative: read(["uniform", "gently varied", "rhythmic", "sharply compressed"], idx, "by the score, which blends compression, squeezes and how long tight and open stretches last"),
        drivers,
        explanation: sentence([
          `Along its main route the cross-section ${compression > 0.15 ? "narrows" : "hardly changes"} from ${num(p.max_ft2)} to ${num(p.min_ft2)} ft² (${num(p.ratio, 1)}:1)${p.squeezes ? `, with ${count(p.squeezes, "distinct squeeze")}` : ""}.`,
          compression > 0.5 ? `A tight stretch (${pct(tight)} of the route) follows an open one (${pct(open)}): compression and release.` : compression > 0.15 ? "The changes are gentle, with no real moment of compression." : "It stays much the same all the way.",
        ]),
        evidence: { route: true, rooms: m.route?.rooms },
      };
    },
  },
];

/** Every descriptor's key and label, in canonical order (no tile needed). */
export const DESCRIPTOR_META: { key: DescriptorKey; label: string }[] = DEFS.map(({ key, label }) => ({ key: key as DescriptorKey, label: matrixOf(key)?.name ?? label }));

function run(defs: Def[], tile: ParsedTile): DescriptorResult[] {
  const m = measuresFor(tile);
  return defs.map((def) => {
    const c = m ? def.compute(m) : noData(def.label.toLowerCase());
    const score = Math.round(clamp(c.score, 0, 100));
    return {
      key: def.key as DescriptorKey,
      label: matrixOf(def.key)?.name ?? def.label,
      ...c,
      score,
      quantValue: c.quant.headline,
      quantCriterion: c.quant.headlineHow,
      verdict: c.qualitative.reading,
      verdictCriterion: c.qualitative.how,
    };
  });
}

export const scoreTile = (tile: ParsedTile): DescriptorResult[] => run(DEFS, tile);

/** The legacy measurements (the earlier Spatial density formula), for a tile. */
export function legacyMeasurementsFor(tile: ParsedTile): DescriptorResult[] {
  return run(LEGACY, tile).map((r) => ({ ...r, key: r.key as unknown as DescriptorKey }));
}

