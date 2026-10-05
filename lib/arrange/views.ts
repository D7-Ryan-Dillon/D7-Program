// Views of an arrangement: the best exterior and interior cameras (auto-find nice views) and the walk-through path.
// All poses are in the arrangement's Z-up feet (lib/arrange/capture.ts turns them into scene coordinates).

import * as THREE from "three";
import type { Composite } from "./composite";
import { toScene, type PoseFt } from "./capture";
import { toFt, type PlacedBox } from "./geometry";
import type { Vec3 } from "./types";

export interface ViewCandidate {
  id: string;
  label: string;
  kind: "exterior" | "interior";
  pose: PoseFt;
  score: number;
}

const FOV_EXT = 38;
const FOV_INT = 72;
const EYE_FT = 5.5;
const ASPECT = 16 / 9;

const boxCorners = (b: PlacedBox): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([toFt(x), toFt(y), toFt(z)]);
  return out;
};

function projectAll(pose: PoseFt, pts: Vec3[]): { xs: number[]; ys: number[]; depths: number[] } {
  const cam = new THREE.PerspectiveCamera(pose.fov, ASPECT, 0.1, 4000);
  cam.up.set(0, 1, 0);
  cam.position.copy(toScene(pose.pos));
  cam.lookAt(toScene(pose.target));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const xs: number[] = [];
  const ys: number[] = [];
  const depths: number[] = [];
  for (const p of pts) {
    const v = toScene(p);
    const d = v.distanceTo(cam.position);
    v.project(cam);
    xs.push(v.x);
    ys.push(v.y);
    depths.push(d);
  }
  return { xs, ys, depths };
}

/** The distance at which every point sits inside the frame with a margin, found by stepping out. */
function fitDistance(dirFromCenter: THREE.Vector3, center: Vec3, pts: Vec3[], fov: number): number {
  let d = 10;
  for (let i = 0; i < 40; i++) {
    const pos = toScene(center).addScaledVector(dirFromCenter, d);
    const p = projectAll({ pos: [pos.x, -pos.z, pos.y], target: center, fov }, pts);
    const m = Math.max(...p.xs.map(Math.abs), ...p.ys.map(Math.abs));
    if (m <= 0.86) return d;
    d *= 1.12;
  }
  return d;
}

/** The best few exterior views (corner and bird's-eye angles) and interior views along the route, scored on composition. */
export function findNiceViews(boxes: PlacedBox[], opts: { comp: Composite | null; route: Vec3[] | null; entrance: Vec3 | null }): ViewCandidate[] {
  if (!boxes.length) return [];
  const pts = boxes.flatMap(boxCorners);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];

  const ext: ViewCandidate[] = [];
  for (let az = 0; az < 360; az += 30)
    for (const el of [14, 28, 45, 68]) {
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      // direction from the centre to the camera, in Z-up then converted
      const dirZ = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
      const dir = new THREE.Vector3(dirZ.x, dirZ.z, -dirZ.y);
      const dist = fitDistance(dir, center, pts, FOV_EXT);
      const campos = toScene(center).addScaledVector(dir, dist);
      const pose: PoseFt = { pos: [campos.x, -campos.z, campos.y], target: center, fov: FOV_EXT };
      const pr = projectAll(pose, pts);
      const w = Math.max(...pr.xs) - Math.min(...pr.xs);
      const h = Math.max(...pr.ys) - Math.min(...pr.ys);
      const fill = Math.max(w / 2, h / 2);
      const cx = (Math.max(...pr.xs) + Math.min(...pr.xs)) / 2;
      const cy = (Math.max(...pr.ys) + Math.min(...pr.ys)) / 2;
      const centering = 1 - Math.min(1, Math.hypot(cx, cy));
      const angle = Math.abs(((az % 90) + 90) % 90 - 45) <= 15 ? 1 : 0.55; // three-quarter views read best
      const elev = el >= 20 && el <= 50 ? 1 : el < 20 ? 0.6 : 0.7;
      const dMin = Math.min(...pr.depths);
      const dMax = Math.max(...pr.depths);
      const depth = Math.min(1, (dMax - dMin) / Math.max(1, dist * 0.6));
      let entranceBonus = 0;
      if (opts.entrance) {
        const ep = projectAll(pose, [opts.entrance]);
        if (Math.abs(ep.xs[0]) < 0.9 && Math.abs(ep.ys[0]) < 0.9) entranceBonus = 0.15;
      }
      const score = 0.3 * Math.min(1, fill / 0.8) + 0.2 * centering + 0.2 * angle + 0.15 * elev + 0.15 * depth + entranceBonus;
      ext.push({ id: `ext-${az}-${el}`, label: `${el < 20 ? "Low" : el > 55 ? "Bird's-eye" : "Corner"} view, ${az}°`, kind: "exterior", pose, score });
    }
  ext.sort((a, b) => b.score - a.score);
  const picked: ViewCandidate[] = [];
  for (const c of ext) {
    const az = Number(c.id.split("-")[1]);
    if (picked.some((p) => Math.min(Math.abs(Number(p.id.split("-")[1]) - az), 360 - Math.abs(Number(p.id.split("-")[1]) - az)) < 60)) continue;
    picked.push(c);
    if (picked.length >= 4) break;
  }

  const inside: ViewCandidate[] = [];
  if (opts.comp && opts.route && opts.route.length > 4) {
    const route = opts.route;
    for (let i = 2; i < route.length - 2; i += Math.max(3, Math.round(route.length / 14))) {
      const p = route[i];
      const q = route[Math.min(route.length - 1, i + 3)];
      const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], 0);
      if (dir.length() < 0.5) continue;
      dir.normalize();
      const rays = rayFan(opts.comp, p, dir);
      const mean = rays.reduce((a, b) => a + b, 0) / rays.length;
      const sd = Math.sqrt(rays.reduce((a, b) => a + (b - mean) ** 2, 0) / rays.length);
      const minFree = Math.min(...rays);
      const score = 0.5 * Math.min(1, mean / 30) + 0.3 * Math.min(1, sd / 14) + 0.2 * (minFree > 3 ? 1 : 0);
      const target: Vec3 = [p[0] + dir.x * 12, p[1] + dir.y * 12, p[2] - 0.4];
      inside.push({ id: `int-${i}`, label: `Inside, ${Math.round((i / route.length) * 100)}% along the route`, kind: "interior", pose: { pos: p, target, fov: FOV_INT }, score });
    }
    inside.sort((a, b) => b.score - a.score);
  }
  return [...picked, ...inside.slice(0, 2)];
}

// ---- looking into the voxels ---------------------------------------------------------------------------------------

function isOpen(c: Composite, p: Vec3): boolean {
  const x = Math.floor((p[0] - c.origin[0]) / c.cell);
  const y = Math.floor((p[1] - c.origin[1]) / c.cell);
  const z = Math.floor((p[2] - c.origin[2]) / c.cell);
  const [nx, ny, nz] = c.grid;
  if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
  const i = (x * ny + y) * nz + z;
  return c.mask[i] === 1 && c.void[i] === 1;
}

function rayFan(c: Composite, from: Vec3, dir: THREE.Vector3): number[] {
  const out: number[] = [];
  const base = Math.atan2(dir.y, dir.x);
  for (const dyaw of [-30, -15, 0, 15, 30])
    for (const pitch of [-8, 0, 8]) {
      const yaw = base + (dyaw * Math.PI) / 180;
      const pit = (pitch * Math.PI) / 180;
      const d: Vec3 = [Math.cos(yaw) * Math.cos(pit), Math.sin(yaw) * Math.cos(pit), Math.sin(pit)];
      let t = 0.5;
      while (t < 60 && isOpen(c, [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t])) t += 0.5;
      out.push(t);
    }
  return out;
}

// ---- the walk-through path -----------------------------------------------------------------------------------------

/** The floor under a point: scans down from the point to the first foam, or null. */
function floorBelow(c: Composite, p: Vec3): number | null {
  for (let z = p[2]; z > c.origin[2] - 0.5; z -= c.cell * 0.5) {
    const x = Math.floor((p[0] - c.origin[0]) / c.cell);
    const y = Math.floor((p[1] - c.origin[1]) / c.cell);
    const zi = Math.floor((z - c.origin[2]) / c.cell);
    const [nx, ny, nz] = c.grid;
    if (x < 0 || y < 0 || zi < 0 || x >= nx || y >= ny || zi >= nz) continue;
    const i = (x * ny + y) * nz + zi;
    if (c.mask[i] === 1 && c.void[i] === 0) return c.origin[2] + (zi + 1) * c.cell;
  }
  return null;
}

/** The route as a smooth walk at eye height: resampled every foot, averaged, lowered to 5.5 ft above the floor beneath. Starts at the end nearest the entrance. */
export function walkPath(comp: Composite, route: Vec3[], entrance: Vec3 | null): Vec3[] {
  if (route.length < 2) return [];
  let pts = route;
  if (entrance) {
    const d0 = Math.hypot(pts[0][0] - entrance[0], pts[0][1] - entrance[1], pts[0][2] - entrance[2]);
    const d1 = Math.hypot(pts[pts.length - 1][0] - entrance[0], pts[pts.length - 1][1] - entrance[1], pts[pts.length - 1][2] - entrance[2]);
    if (d1 < d0) pts = [...pts].reverse();
  }
  // resample every foot
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  const W = 4;
  const sm = out.map((_, i) => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(out.length - 1, i + W); k++) {
      sx += out[k][0];
      sy += out[k][1];
      sz += out[k][2];
      n++;
    }
    return [sx / n, sy / n, sz / n] as Vec3;
  });
  return sm.map((p) => {
    const f = floorBelow(comp, p);
    return [p[0], p[1], (f ?? p[2] - EYE_FT + 1.5) + EYE_FT] as Vec3;
  });
}

/** The camera at `t` (0..1) along a walk path, looking ahead. */
export function walkPose(path: Vec3[], t: number, fov = FOV_INT): PoseFt {
  const n = path.length - 1;
  const f = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const a = path[i];
  const b = path[i + 1];
  const pos: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const ahead = path[Math.min(n, i + 7)];
  const aim: Vec3 = ahead === a || (ahead[0] === pos[0] && ahead[1] === pos[1]) ? [pos[0] + (b[0] - a[0]) * 10, pos[1] + (b[1] - a[1]) * 10, pos[2]] : [ahead[0], ahead[1], pos[2] - 0.3];
  return { pos, target: aim, fov };
}
