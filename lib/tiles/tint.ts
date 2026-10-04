// Colours the void mesh by room or by level (the Viewer's "Rooms" layer), or lights the rooms / levels the Analysis names
// as evidence. Works on the mesh the tile already has: each vertex takes the room (or level) of the void cell it sits in,
// so no extra geometry is made.

import type { ParsedTile } from "@/lib/types";

export type TintMode = "none" | "rooms" | "levels";

export interface TintEmphasis {
  rooms?: number[];
  levels?: number[];
}

const ROOM_COLORS = ["#c43383", "#db7228", "#e8a6c8", "#f2b878", "#8e2462", "#a8541b", "#d96aa6", "#ffb04d"];
const DIM = "#2c2c2c";
const LIGHT = "#db7228";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** True for a tile whose GLB the Sections builder wrote (feet, Y up); the engine's is metres, Y up, with y flipped. */
function isBuilderGlb(tile: ParsedTile): boolean {
  return !!tile.schema?.startsWith("section-field") || tile.engineVersion === "section-field-builder";
}

/** Per-vertex RGB (0..1) for the vertices of the tile's void mesh, or null when the tile has no room data or nothing to tint. */
export function vertexTint(tile: ParsedTile, positions: ArrayLike<number>, mode: TintMode, emphasis?: TintEmphasis): Float32Array | null {
  const rooms = tile.voxels.rooms;
  const vd = tile.voxels.void;
  const levels = tile.spaces?.levels ?? [];
  const wantRooms = !!emphasis?.rooms?.length;
  const wantLevels = !!emphasis?.levels?.length;
  if (!vd || (mode === "none" && !wantRooms && !wantLevels)) return null;
  if ((mode === "rooms" || wantRooms) && !rooms) return null;
  const [nx, ny, nz] = tile.grid;
  const cell = tile.cellFt;
  const builder = isBuilderGlb(tile);
  const k = builder ? 1 : 1 / 0.3048;
  const out = new Float32Array(positions.length);
  const count = positions.length / 3;
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : (x * ny + y) * nz + z);
  const levelOfLayer = (layer: number) => {
    for (const l of levels) if (layer >= l.layers[0] - 1 && layer <= l.layers[1] + 1) return l.id;
    return 0;
  };
  const roomSet = new Set(emphasis?.rooms ?? []);
  const levelSet = new Set(emphasis?.levels ?? []);
  const emphasised = wantRooms || wantLevels;
  const NEIGHBOURS: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let v = 0; v < count; v++) {
    const X = positions[v * 3];
    const Y = positions[v * 3 + 1];
    const Z = positions[v * 3 + 2];
    // glTF -> tile feet -> cell
    const fx = builder ? X : X * k;
    const fy = builder ? Z : -Z * k;
    const fz = builder ? Y : Y * k;
    const cx = Math.min(nx - 1, Math.max(0, Math.floor(fx / cell)));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor(fy / cell)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor(fz / cell)));
    // a vertex sits on the surface, so the room is the one of the nearest void cell
    let room = 0;
    let cellAt = -1;
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const i = at(cx + dx, cy + dy, cz + dz);
      if (i >= 0 && vd[i]) {
        room = rooms ? rooms[i] : 0;
        cellAt = i;
        break;
      }
    }
    let level = 0;
    if (mode === "levels" || wantLevels) {
      let z = cz;
      while (z > 0 && vd[(cx * ny + cy) * nz + z]) z--;
      level = levelOfLayer(vd[(cx * ny + cy) * nz + z] ? z : z + 1);
    }
    let color: string;
    if (emphasised) {
      const hit = (wantRooms && roomSet.has(room)) || (wantLevels && levelSet.has(level));
      color = hit ? LIGHT : DIM;
    } else if (mode === "levels") color = level ? ROOM_COLORS[(level - 1) % ROOM_COLORS.length] : DIM;
    else color = room ? ROOM_COLORS[(room - 1) % ROOM_COLORS.length] : cellAt >= 0 ? DIM : DIM;
    const [r, g, b] = rgb(color);
    out[v * 3] = r;
    out[v * 3 + 1] = g;
    out[v * 3 + 2] = b;
  }
  return out;
}
