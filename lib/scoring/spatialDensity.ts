// Spatial density: the ratio of the narrowest to the widest passage width along a route a person could walk (the matrix's "perceived contrast
// between narrowest and widest moments"). The width is read
// where someone would stand (a few feet above a floor the route is supported on), across the direction of travel, between the material on
// either side. A passage is not a line through the void: if the tile has no floor-supported route from an opening, nothing is measured.
//
// Method (shown with the result): the route's widths are smoothed over a short window (voxel noise is not a constriction); the typical width
// is their median; a constriction is a stretch at least 2 ft long narrower than `constrictionRatio` of that, an expansion a stretch at
// least 2 ft long wider than `expansionRatio` of it; the quantity is narrowest / widest of the smoothed widths. It does not say that a
// bigger contrast is better.

import type { ParsedTile } from "@/lib/types";
import type { Assumptions } from "./assumptions";
import { findRoute, passageWidths, voxelFacts, type RouteOverride0, type RouteResult, type RouteWalk } from "./voxelFacts";

export interface Stretch {
  kind: "constriction" | "expansion";
  /** distance along the route where it starts, ft, and its length */
  fromFt: number;
  lengthFt: number;
  /** the narrowest / widest width within it, ft, and where (tile coordinates) */
  widthFt: number;
  at: [number, number, number];
}

export interface PassageProfile {
  route: RouteWalk;
  widths: number[];
  along: number[];
  smooth: number[];
  typicalFt: number;
  narrowFt: number;
  wideFt: number;
  narrowAt: [number, number, number];
  wideAt: [number, number, number];
  /** narrowest / widest */
  ratio: number;
  stretches: Stretch[];
  /** a constriction followed by an expansion further along the route */
  releases: number;
}

export type SpatialDensityResult = { ok: true; profile: PassageProfile; routeResult: RouteResult } | { ok: false; reason: string; routeResult: RouteResult | null };

const MIN_ROUTE_FT = 8;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

export function spatialDensityFor(tile: ParsedTile, a: Pick<Assumptions, "passageHeightFt" | "constrictionRatio" | "expansionRatio">, over?: RouteOverride0): SpatialDensityResult {
  const f = voxelFacts(tile);
  if (!f) return { ok: false, reason: "This tile carries no voxel data, so no passage can be measured.", routeResult: null };
  const rr = findRoute(f, { from: over?.from, to: over?.to, destination: "farthest" });
  if (!rr.route) return { ok: false, reason: rr.reason, routeResult: rr };
  if (rr.route.lengthFt < MIN_ROUTE_FT) return { ok: false, reason: `The route from the entry is only ${rr.route.lengthFt.toFixed(0)} ft long: too short to read a sequence of passage widths.`, routeResult: rr };
  const { widths: raw, along } = passageWidths(f, rr.route, a.passageHeightFt);
  // fill the gaps (a stair turning on the spot has no direction) and smooth over about 3 ft
  const filled = raw.map((w, i) => (Number.isFinite(w) ? w : i > 0 ? raw[i - 1] : NaN));
  const first = filled.find((w) => Number.isFinite(w));
  if (first === undefined) return { ok: false, reason: "The route has no stretch with a direction of travel to measure a width across.", routeResult: rr };
  const clean = filled.map((w) => (Number.isFinite(w) ? w : first));
  const win = Math.max(1, Math.round(1.5 / f.cell));
  const smooth = clean.map((_, i) => {
    const lo = Math.max(0, i - win);
    const hi = Math.min(clean.length - 1, i + win);
    return median(clean.slice(lo, hi + 1));
  });
  const typical = median(smooth);
  let ni = 0;
  let wi = 0;
  smooth.forEach((w, i) => {
    if (w < smooth[ni]) ni = i;
    if (w > smooth[wi]) wi = i;
  });
  // constrictions and expansions: runs of the smoothed width beyond the thresholds, at least 2 ft long
  const stretches: Stretch[] = [];
  const minRun = Math.max(2, Math.round(2 / f.cell));
  const scan = (kind: "constriction" | "expansion") => {
    const test = (w: number) => (kind === "constriction" ? w < typical * a.constrictionRatio : w > typical * a.expansionRatio);
    let s = -1;
    for (let i = 0; i <= smooth.length; i++) {
      const on = i < smooth.length && test(smooth[i]);
      if (on && s < 0) s = i;
      else if (!on && s >= 0) {
        if (i - s >= minRun) {
          let best = s;
          for (let k = s; k < i; k++) if (kind === "constriction" ? smooth[k] < smooth[best] : smooth[k] > smooth[best]) best = k;
          stretches.push({ kind, fromFt: along[s], lengthFt: along[i - 1] - along[s] + f.cell, widthFt: smooth[best], at: rr.route!.points[best] });
        }
        s = -1;
      }
    }
  };
  scan("constriction");
  scan("expansion");
  stretches.sort((x, y) => x.fromFt - y.fromFt);
  let releases = 0;
  for (let i = 0; i < stretches.length; i++) if (stretches[i].kind === "constriction" && stretches.slice(i + 1).some((s) => s.kind === "expansion")) releases++;
  const profile: PassageProfile = {
    route: rr.route,
    widths: raw,
    along,
    smooth,
    typicalFt: typical,
    narrowFt: smooth[ni],
    wideFt: smooth[wi],
    narrowAt: rr.route.points[ni],
    wideAt: rr.route.points[wi],
    ratio: smooth[wi] > 0 ? smooth[ni] / smooth[wi] : 1,
    stretches,
    releases,
  };
  return { ok: true, profile, routeResult: rr };
}
