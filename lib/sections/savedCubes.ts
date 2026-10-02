// A piece made in the Sections cube/hex builder, kept with the project code
// whether or not it was ever added to the tile bank. Every Generate in the
// builder saves (and keeps updating) one of these, so past experiments are
// always there under "Saved objects" -- on any device that enters the code.
//
// Self-contained on purpose: it carries the actual vector traces it was
// lofted from, not just tile names, so reopening it reproduces the same
// shape even if the source photo was later re-traced or only exists in
// another browser's local tile bank.

import type { SectionTrace, VolumeShape } from "./volumeField";
import type { CleanupSettings } from "./cleanup";
import type { PlateSettings } from "./plates";

export interface SavedCube {
  id: string;
  name: string;
  createdAt: number;
  shape: VolumeShape;
  /** Face name -> the bank tile (its stable `name`) that supplied the trace. */
  assignments: Record<string, string>;
  /** Face name -> the trace itself, as it was when the piece was generated. */
  traces: Record<string, SectionTrace>;
  seed: number;
  fitTolerance: number;
  cleanup: CleanupSettings;
  /** Foam and void roles swapped (foam = the cube minus the lofted shape). */
  swapped: boolean;
  /** Quarter turns (0-3) given to each face's trace, for reopening in the builder. The stored traces are already turned. */
  rotations?: Record<string, number>;
  /** Floor plates (absent on pieces saved before they existed). */
  plates?: PlateSettings;
  /** Small PNG data URL for the Saved objects list. */
  thumb?: string;
}

/** Everything about a cube that defines its shape -- compared to decide
 * whether an edit needs saving (thumbnail excluded: it follows from this). */
export function cubeSignature(c: Omit<SavedCube, "thumb" | "createdAt" | "id">): string {
  return JSON.stringify([c.name, c.shape, c.assignments, c.seed, c.fitTolerance, c.cleanup, c.swapped, c.plates ?? null, c.rotations ?? null, Object.keys(c.traces).sort()]);
}
