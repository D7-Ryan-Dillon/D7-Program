// Will it print, and will it hold? Traffic-light checks read from a tile's structure (lib/tiles/analyze.ts or the engine's
// data/structure.json) at a chosen print scale. They are plausibility checks for a 3D print of the foam, not engineering.

import type { ParsedTile } from "@/lib/types";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export const NOZZLE_MM = 0.4;
/** Print scale as 1 : ratio; 120 = 1 inch per 10 feet (1 ft = 2.54 mm). */
export const DEFAULT_RATIO = 120;

export const mmPerFt = (ratio: number) => 304.8 / ratio;

/** The smallest wall (feet) a nozzle can lay down at this scale: two perimeters. */
export const minWallFt = (ratio: number, nozzleMm = NOZZLE_MM) => (2 * nozzleMm) / mmPerFt(ratio);

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

export function printChecks(tile: ParsedTile, ratio = DEFAULT_RATIO, nozzleMm = NOZZLE_MM): Check[] {
  const s = tile.structure;
  if (!s) return [];
  const checks: Check[] = [];
  const mm = mmPerFt(ratio);

  // one piece
  if (s.foam_pieces <= 1) checks.push({ key: "pieces", label: "One piece", status: "ok", detail: "the foam is a single body" });
  else {
    const small = s.floating_ft3 * mm ** 3 < 200; // under about 0.2 cm3 printed: a speck, not a part
    checks.push({
      key: "pieces",
      label: "One piece",
      status: small ? "warn" : "fail",
      detail: `${s.foam_pieces} separate foam pieces, ${s.floating_ft3.toFixed(1)} ft³ outside the main body${small ? " (specks)" : ": each prints on its own"}`,
    });
  }

  // thinnest wall against the nozzle
  const need = minWallFt(ratio, nozzleMm);
  const keys = Object.keys(s.thin_share)
    .map(Number)
    .sort((a, b) => a - b);
  const key = keys.find((k) => k >= need) ?? keys[keys.length - 1];
  const share = key !== undefined ? (s.thin_share[String(key)] ?? 0) : 0;
  checks.push({
    key: "walls",
    label: "Wall thickness",
    status: share <= 0.005 ? "ok" : share <= 0.05 ? "warn" : "fail",
    detail: `${pct(share)} of the foam is thinner than ${key} ft (${(key * mm).toFixed(1)} mm printed); a ${nozzleMm} mm nozzle needs walls of ${(2 * nozzleMm).toFixed(1)} mm (${need.toFixed(2)} ft at this scale)`,
  });

  // plates held to the ground
  const loose = s.plates.filter((p) => !p.grounded);
  const unsupported = s.plates.filter((p) => p.support && p.support.supported === false);
  checks.push({
    key: "plates",
    label: "Plates joined to the body",
    status: loose.length ? "fail" : unsupported.length ? "warn" : "ok",
    detail: loose.length
      ? `${loose.length} plate(s) float free of the grounded foam`
      : unsupported.length
        ? `${unsupported.length} plate(s) span farther than the engine's support rule allows`
        : s.plates.length
          ? `all ${s.plates.length} plate(s) join the grounded foam`
          : "no floor plates",
  });

  // overhangs
  checks.push({
    key: "overhang",
    label: "Overhangs",
    status: s.overhang_share <= 0.15 ? "ok" : s.overhang_share <= 0.35 ? "warn" : "fail",
    detail: `${pct(s.overhang_share)} of the foam surface faces down over void (${s.overhang_area_ft2.toFixed(0)} ft²); expect supports in the print`,
  });

  // bed contact
  const footprint = tile.tileFt[0] * tile.tileFt[1];
  const bed = footprint > 0 ? s.bed_contact_ft2 / footprint : 0;
  checks.push({
    key: "bed",
    label: "Contact with the print bed",
    status: bed >= 0.25 ? "ok" : bed >= 0.08 ? "warn" : "fail",
    detail: `${pct(bed)} of the footprint is foam on the bottom face (${s.bed_contact_ft2.toFixed(0)} ft²)`,
  });
  return checks;
}
