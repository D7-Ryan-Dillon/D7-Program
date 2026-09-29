/**
 * Named camera views, matching Rhino's own naming and the face-viewing
 * convention already fixed by the export pipeline (HANDOFF.md section 3):
 * every face is "seen from outside", camera on the outward-normal side
 * looking back in, up = +Z except when looking straight down/up the Z axis.
 *
 * Rhino/feet space uses X,Y horizontal, Z up. The GLB is Y-up metres with
 * (x, y, z)_rhino -> (x, z, -y)_glb (see HANDOFF's to_tile_ft_row_major).
 * Direction vectors below are already converted to GLB space.
 */
export interface ViewPreset {
  key: string;
  label: string;
  /** Unit vector, in GLB space, from the tile center toward the camera. */
  dir: [number, number, number];
  /** Camera up vector, in GLB space. */
  up: [number, number, number];
}

function rhinoToGlb([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, z, -y];
}

function view(key: string, label: string, dirRhino: [number, number, number], upRhino: [number, number, number]): ViewPreset {
  return { key, label, dir: rhinoToGlb(dirRhino), up: rhinoToGlb(upRhino) };
}

export const VIEW_PRESETS: ViewPreset[] = [
  view("front", "Front", [0, -1, 0], [0, 0, 1]),
  view("back", "Back", [0, 1, 0], [0, 0, 1]),
  view("right", "Right", [1, 0, 0], [0, 0, 1]),
  view("left", "Left", [-1, 0, 0], [0, 0, 1]),
  view("top", "Top", [0, 0, 1], [0, 1, 0]),
  view("bottom", "Bottom", [0, 0, -1], [0, 1, 0]),
];

export const PERSPECTIVE_VIEW: ViewPreset = view("perspective", "Perspective", [1.1, -1.4, 0.9], [0, 0, 1]);

export const ALL_VIEWS: ViewPreset[] = [...VIEW_PRESETS, PERSPECTIVE_VIEW];
