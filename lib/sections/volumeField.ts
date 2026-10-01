// Ported from Section-Field's lib/volume-study.ts (the "3D Object Study"):
// loft several 2D section traces, each assigned to one face of a cube or
// hexagonal prism, into one continuous 3D scalar field. The math is kept
// close to the original -- it's already been exercised against real tile
// traces -- adapted only to this repo's own trace type (SectionTrace
// instead of their React-coupled Correction) and face-name conventions.
//
// A positive field value means "material" (foam), negative means "void" --
// matching this app's own foam/void convention, same as the Grasshopper
// engine's void_smooth.u8 (just not yet quantized to a byte).

export const cubeFaces = ["front", "back", "left", "right", "top", "bottom"] as const;
export const prismFaces = ["side1", "side2", "side3", "side4", "side5", "side6", "top", "bottom"] as const;
export type VolumeShape = "cube" | "hex-prism";
export type VolumeFaceName = (typeof cubeFaces)[number] | (typeof prismFaces)[number];

export function facesForShape(shape: VolumeShape): readonly VolumeFaceName[] {
  return shape === "hex-prism" ? prismFaces : cubeFaces;
}

export const HEX_APOTHEM = Math.sqrt(3) / 2;
export function hexSidePose(index: number) {
  const angle = (index * Math.PI) / 3;
  return { angle, x: Math.cos(angle) * HEX_APOTHEM, z: Math.sin(angle) * HEX_APOTHEM };
}

/** A finished, correction-edited 2D trace ready to loft -- the output shape
 * of lib/sections' Paper.js correction editor (and, pre-edit, of its
 * auto-trace proposal): one or more filled SVG path strings in a fixed
 * width x height coordinate space, using the evenodd fill rule so a void
 * drawn inside a mass punches a real hole. */
export interface SectionTrace {
  width: number;
  height: number;
  shapes: { d: string }[];
}

export type VolumeAssignments = Partial<Record<VolumeFaceName, SectionTrace>>;

const MASK_SIZE = 112;

/** Rasterizes one trace to a binary mask at a fixed square resolution,
 * centered and uniformly scaled to fit -- same approach regardless of the
 * trace's own aspect ratio, so a portrait or landscape source photo both
 * land consistently on a cube/hex face. */
export function faceMask(trace: SectionTrace, size = MASK_SIZE): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable");
  const scale = size / Math.max(trace.width, trace.height);
  ctx.translate((size - trace.width * scale) / 2, (size - trace.height * scale) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  for (const shape of trace.shapes) ctx.fill(new Path2D(shape.d), "evenodd");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const binary = new Uint8Array(size * size);
  for (let i = 0; i < binary.length; i++) binary[i] = rgba[i * 4 + 3] > 127 ? 1 : 0;
  return binary;
}

/** A short chamfer distance transform (two raster passes, not an exact
 * Euclidean EDT) -- plenty smooth for lofting a face mask into a volume,
 * and far cheaper than an exact transform at this resolution. */
function signedMask(binary: Uint8Array, size: number): Float32Array {
  const field = new Float32Array(binary.length);
  for (let i = 0; i < field.length; i++) field[i] = binary[i] ? 32 : -32;
  for (let pass = 0; pass < 2; pass++) {
    const forward = pass === 0;
    for (let yi = 0; yi < size; yi++) {
      const y = forward ? yi : size - 1 - yi;
      for (let xi = 0; xi < size; xi++) {
        const x = forward ? xi : size - 1 - xi;
        const i = y * size + x;
        const sign = binary[i] ? 1 : -1;
        let distance = Math.abs(field[i]);
        for (const [dx, dy, step] of [
          [-1, 0, 1],
          [0, -1, 1],
          [-1, -1, 1.414],
          [1, -1, 1.414],
        ] as const) {
          const nx = x + (forward ? dx : -dx);
          const ny = y + (forward ? dy : -dy);
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const ni = ny * size + nx;
          if (binary[ni] !== binary[i]) distance = Math.min(distance, step / 2);
          else distance = Math.min(distance, Math.abs(field[ni]) + step);
        }
        field[i] = sign * distance;
      }
    }
  }
  return field;
}

/** Maps a point in the volume's own [0,1]^3 local space to (u, v, depth) on
 * one named face -- depth is how far inward from that face the point sits
 * (0 = right on the face), u/v are that face's own 2D mask coordinates. */
function coordinates(face: VolumeFaceName, x: number, y: number, z: number, shape: VolumeShape): readonly [number, number, number] {
  if (shape === "hex-prism" && face.startsWith("side")) {
    const { angle } = hexSidePose(Number(face.slice(4)) - 1);
    const worldX = x * 2 - 1,
      worldZ = z * 2 - 1;
    const normal = worldX * Math.cos(angle) + worldZ * Math.sin(angle);
    const tangent = -worldX * Math.sin(angle) + worldZ * Math.cos(angle);
    return [0.5 + tangent, 1 - y, (HEX_APOTHEM - normal) / (2 * HEX_APOTHEM)] as const;
  }
  switch (face) {
    case "front":
      return [x, 1 - y, z] as const;
    case "back":
      return [1 - x, 1 - y, 1 - z] as const;
    case "left":
      return [z, 1 - y, x] as const;
    case "right":
      return [1 - z, 1 - y, 1 - x] as const;
    case "top":
      return [x, z, 1 - y] as const;
    case "bottom":
      return [x, 1 - z, y] as const;
  }
  throw new Error(`Unsupported volume face: ${face}`);
}

export interface VolumeField {
  field: Float32Array;
  resolution: number;
  /** Percent of face-mask cells whose sign survived the merge unchanged --
   * a rough "how much did merging distort your drawn shape" readout for
   * the builder UI. */
  faceFit: number;
}

/** A smooth/organic version of Math.max(a, b): identical to Math.max at
 * k = 0 (a sharp boolean union), rounding the seam where a and b cross as
 * k grows. Used to merge each active face's own mass into one continuous
 * surface instead of a hard-edged union. */
function smoothMax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  return (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
}

/** Builds the merged 3D scalar field for a set of face assignments: each
 * active face's drawn mask is a *mass* on that side of the cube/hex, not a
 * decal, so it's extruded through the full depth (its signed value at a
 * point depends only on that point's lateral position on the face's own
 * plane, never on how far the point is from the face) -- then every
 * active face's extrusion is merged into one field with a smooth/organic
 * union (see smoothMax), so the result reads as all the drawn masses
 * fused into a single solid, not a blurry average of them. The "foam"
 * tile is this merged solid; "void" is simply its geometric complement
 * (see voxelize.ts) -- there's no separate void computation. */
export function buildVolumeField(assignments: VolumeAssignments, shape: VolumeShape, fitTolerance: number, resolution = 46): VolumeField {
  const active = facesForShape(shape).flatMap((name) => {
    const trace = assignments[name];
    if (!trace) return [];
    return [{ name, distance: signedMask(faceMask(trace), MASK_SIZE) }];
  });
  const n = resolution;
  const field = new Float32Array(n * n * n);
  if (!active.length) return { field, resolution: n, faceFit: 0 };

  const index = (x: number, y: number, z: number) => z * n * n + y * n + x;
  const tolerance = Math.max(0, Math.min(100, fitTolerance));
  const mergeK = 0.03 + tolerance * 0.004;
  let compared = 0;
  let changed = 0;

  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = index(x, y, z);
        if (x <= 1 || y <= 1 || z <= 1 || x >= n - 2 || y >= n - 2 || z >= n - 2) {
          field[i] = -1;
          continue;
        }
        const p = [x, y, z].map((value) => (value - 2) / (n - 5));
        let clearance = Infinity;
        if (shape === "hex-prism") {
          const worldX = p[0] * 2 - 1,
            worldZ = p[2] * 2 - 1;
          for (let side = 0; side < 6; side++) {
            const angle = (side * Math.PI) / 3;
            clearance = Math.min(clearance, HEX_APOTHEM - worldX * Math.cos(angle) - worldZ * Math.sin(angle));
          }
          if (clearance < 0) {
            field[i] = -1;
            continue;
          }
        }

        let value = -1;
        let first = true;
        const owned: number[] = [];
        for (const face of active) {
          const [u, v, depth] = coordinates(face.name, p[0], p[1], p[2], shape);
          const mx = Math.max(0, Math.min(MASK_SIZE - 1, Math.round(u * (MASK_SIZE - 1))));
          const my = Math.max(0, Math.min(MASK_SIZE - 1, Math.round(v * (MASK_SIZE - 1))));
          const signed = Math.max(-1, Math.min(1, face.distance[my * MASK_SIZE + mx] / 2.4));
          value = first ? signed : smoothMax(value, signed, mergeK);
          first = false;
          if (depth < (shape === "hex-prism" && face.name.startsWith("side") ? 0.035 : 0.0001)) owned.push(signed);
        }
        for (const signed of owned) {
          compared++;
          if (value > 0 !== signed > 0) changed++;
        }
        if (shape === "hex-prism") value = Math.min(value, clearance * 3);
        field[i] = value;
      }

  return { field, resolution: n, faceFit: compared ? Math.round((1 - changed / compared) * 100) : 0 };
}

/** Trilinear-samples the lofted field at a world point in the same [-1,1]^3
 * (cube) or hex-apothem-bounded space buildVolumeField's own voxel loop
 * uses -- the one place a caller (e.g. the voxelizer) needs to go from a
 * continuous world point back into the discrete field. */
export function sampleVolumeField(field: Float32Array, resolution: number, x: number, y: number, z: number): number {
  const n = resolution;
  const toGrid = (world: number) => Math.max(0, Math.min(n - 1.001, (world * (n - 4) + n) / 2));
  const gx = toGrid(x),
    gy = toGrid(y),
    gz = toGrid(z);
  const x0 = Math.floor(gx),
    y0 = Math.floor(gy),
    z0 = Math.floor(gz);
  const dx = gx - x0,
    dy = gy - y0,
    dz = gz - z0;
  const at = (ix: number, iy: number, iz: number) => field[iz * n * n + iy * n + ix];
  const lower = (at(x0, y0, z0) * (1 - dx) + at(x0 + 1, y0, z0) * dx) * (1 - dy) + (at(x0, y0 + 1, z0) * (1 - dx) + at(x0 + 1, y0 + 1, z0) * dx) * dy;
  const upper =
    (at(x0, y0, z0 + 1) * (1 - dx) + at(x0 + 1, y0, z0 + 1) * dx) * (1 - dy) + (at(x0, y0 + 1, z0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1, z0 + 1) * dx) * dy;
  return lower * (1 - dz) + upper * dz;
}
