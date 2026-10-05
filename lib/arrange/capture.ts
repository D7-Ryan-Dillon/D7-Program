// Stills and animations from an Arrange viewport at any camera, not only the live one (the same offscreen-renderer idea
// as lib/viewportCapture.ts, which only starts from the live camera). The scene is Y-up with the arrangement's Z-up feet
// placed through a -90 degree turn about X, so a pose given in Z-up feet is converted with (x, y, z) -> (x, z, -y).

import * as THREE from "three";
import type { ViewportHandle } from "@/lib/viewportCapture";
import type { BoardAnimation } from "@/lib/boards/exportBoard";
import type { Vec3 } from "./types";

/** A camera in the arrangement's own Z-up feet. */
export interface PoseFt {
  pos: Vec3;
  target: Vec3;
  fov: number;
  /** bank about the view axis, degrees (a drone leaning into a turn) */
  roll?: number;
}

export const toScene = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[2], -v[1]);
export const fromScene = (v: THREE.Vector3): Vec3 => [v.x, -v.z, v.y];

export interface PoseOptions {
  width: number;
  height: number;
  background: string;
  transparent?: boolean;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function makeRenderer(width: number, height: number, alpha: boolean): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true, stencil: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  return renderer;
}

function camera(pose: PoseFt, width: number, height: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(pose.fov, width / height, 0.05, 4000);
  cam.up.set(0, 1, 0);
  cam.position.copy(toScene(pose.pos));
  cam.lookAt(toScene(pose.target));
  if (pose.roll) cam.rotateZ((pose.roll * Math.PI) / 180);
  cam.updateProjectionMatrix();
  return cam;
}

function draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, pose: PoseFt, o: PoseOptions) {
  const cam = camera(pose, o.width, o.height);
  const env = scene.environment;
  const bg = scene.background;
  scene.environment = null;
  scene.background = o.transparent ? null : new THREE.Color(o.background);
  try {
    renderer.setClearColor(0x000000, o.transparent ? 0 : 1);
    renderer.render(scene, cam);
  } finally {
    scene.environment = env;
    scene.background = bg;
  }
}

function need(handle: ViewportHandle) {
  const snap = handle.snapshot();
  if (!snap) throw new Error("The viewport isn't ready yet.");
  return snap;
}

/** Hides the helpers drawn over the model (joint plates, the entrance mark, the site box, evidence, measuring) while a picture is taken; returns the undo. */
export function hideOverlays(scene: THREE.Object3D): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.overlay && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return () => hidden.forEach((o) => (o.visible = true));
}

const release = (r: THREE.WebGLRenderer) => {
  r.dispose();
  r.forceContextLoss();
};

/** One still from a pose, as a PNG. */
export async function capturePosePng(handle: ViewportHandle, pose: PoseFt, o: PoseOptions): Promise<Blob> {
  const snap = need(handle);
  const w = even(o.width);
  const h = even(o.height);
  const renderer = makeRenderer(w, h, !!o.transparent);
  const restore = hideOverlays(snap.scene);
  try {
    draw(renderer, snap.scene, pose, { ...o, width: w, height: h });
    return await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the PNG."))), "image/png"));
  } finally {
    restore();
    release(renderer);
  }
}

/** A small data URL of a pose (a thumbnail). */
export function poseDataUrl(handle: ViewportHandle, pose: PoseFt, width: number, height: number, background = "#000000"): string | null {
  const snap = handle.snapshot();
  if (!snap) return null;
  const renderer = makeRenderer(width, height, false);
  const restore = hideOverlays(snap.scene);
  try {
    draw(renderer, snap.scene, pose, { width, height, background });
    return renderer.domElement.toDataURL("image/png");
  } finally {
    restore();
    release(renderer);
  }
}

/** Small data URLs of several poses with one renderer (a thumbnail strip). */
export function poseDataUrls(handle: ViewportHandle, poses: PoseFt[], width: number, height: number, background = "#000000"): (string | null)[] {
  const snap = handle.snapshot();
  if (!snap) return poses.map(() => null);
  const renderer = makeRenderer(width, height, false);
  const restore = hideOverlays(snap.scene);
  try {
    return poses.map((pose) => {
      draw(renderer, snap.scene, pose, { width, height, background });
      return renderer.domElement.toDataURL("image/png");
    });
  } finally {
    restore();
    release(renderer);
  }
}

/** Frames along any camera path: `poseAt(i, n)` gives frame i of n; `before(i)` may change the scene (show pieces one by one); `after()` restores it. */
export function createPoseAnimation(
  handle: ViewportHandle,
  poseAt: (i: number, n: number) => PoseFt,
  frameCount: number,
  size: { width: number; height: number; background: string },
  hooks: { before?: (i: number) => void; after?: () => void; /** 0..1 visibility of frame i of n (0 = black); the first and last frames at 0 make a film that loops seamlessly */ fade?: (i: number, n: number) => number } = {},
): BoardAnimation {
  const snap = need(handle);
  const width = even(size.width);
  const height = even(size.height);
  const renderer = makeRenderer(width, height, false);
  const restoreOverlays = hideOverlays(snap.scene);
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    restoreOverlays();
    release(renderer);
    throw new Error("Canvas 2D context unavailable");
  }
  return {
    width,
    height,
    frameCount,
    canvas: frame,
    renderFrame(i: number) {
      hooks.before?.(i);
      draw(renderer, snap.scene, poseAt(i, frameCount), { width, height, background: size.background });
      ctx.drawImage(renderer.domElement, 0, 0);
      const a = hooks.fade ? hooks.fade(i, frameCount) : 1;
      if (a < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, a)})`;
        ctx.fillRect(0, 0, width, height);
      }
    },
    dispose() {
      hooks.after?.();
      restoreOverlays();
      release(renderer);
    },
  };
}

/** The look for a walk-through: the void is hidden and the foam made solid, so the camera sees real walls, floors and plates instead of the magenta negative; a soft headlight rides with the camera. Returns the light (move it per frame) and the undo. */
export function applyTourLook(scene: THREE.Object3D): { light: THREE.PointLight; restore: () => void } {
  const undo: (() => void)[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.name === "void") {
      const was = o.visible;
      o.visible = false;
      undo.push(() => (o.visible = was));
    } else if (o.name === "foam") {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue;
        const was = { t: m.transparent, op: m.opacity, dw: m.depthWrite };
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        m.needsUpdate = true;
        undo.push(() => {
          m.transparent = was.t;
          m.opacity = was.op;
          m.depthWrite = was.dw;
          m.needsUpdate = true;
        });
      }
    }
  });
  const light = new THREE.PointLight(0xfff0e0, 1.1, 0, 0);
  scene.add(light);
  undo.push(() => scene.remove(light));
  return { light, restore: () => undo.forEach((f) => f()) };
}

/** A fade in from black and out to black over `seconds` at each end, smooth: use as the `fade` hook of a film that should loop. */
export function loopFade(fps: number, seconds = 0.9) {
  return (i: number, n: number) => {
    const f = Math.max(4, Math.round(fps * seconds));
    const a = Math.min(i / f, (n - 1 - i) / f, 1);
    return a <= 0 ? 0 : a * a * (3 - 2 * a);
  };
}

/**
 * A build-up film: the placed pieces arrive one by one, in the order given. Each drops in from above and fades solid; once it has landed
 * its void fades in (the space is made). `before(i, n)` poses every piece for frame i; `after()` puts the scene back exactly as it was.
 * Returns null when the scene has no separate pieces (the smooth combined model).
 */
export function buildUpHooks(scene: THREE.Object3D, ids: string[], boxes: Record<string, { min: Vec3; max: Vec3 }> = {}): { before: (i: number, n: number) => void; after: () => void; /** centre and radius (ft) of what is standing at film time t (0..1), smoothed */ extent: (t: number) => { center: Vec3; radius: number } | null } | null {
  type Mat = THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean };
  const items: { g: THREE.Object3D; matrix: THREE.Matrix4; visible: boolean; solid: { m: Mat; opacity: number; transparent: boolean; depthWrite: boolean }[]; voids: { mesh: THREE.Mesh; m: Mat; visible: boolean; opacity: number; transparent: boolean; depthWrite: boolean }[] }[] = [];
  for (const id of ids) {
    const g = scene.getObjectByName(`piece-${id}`);
    if (!g) continue;
    const it = { g, matrix: g.matrix.clone(), visible: g.visible, solid: [] as (typeof items)[number]["solid"], voids: [] as (typeof items)[number]["voids"] };
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Mat[]) {
        const rec = { m, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
        if (o.name === "void") it.voids.push({ mesh: o, visible: o.visible, ...rec });
        else it.solid.push(rec);
      }
    });
    items.push(it);
  }
  if (!items.length) return null;
  const N = items.length;
  const P = 0.82; // the pieces are all down by this share of the film; the rest is a held view of the finished building
  const D = Math.max(0.05, Math.min(0.14, (1.6 / N) * P)); // how long one piece takes to arrive, as a share of the film
  const startOf = (k: number) => (N > 1 ? (k / (N - 1)) * (P - D) : 0);
  const boxAt = (t: number) => {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    items.forEach((it, k) => {
      const b = boxes[ids[k]];
      if (!b || t < startOf(k)) return;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], b.min[a]);
        hi[a] = Math.max(hi[a], b.max[a]);
      }
    });
    return lo[0] === Infinity ? null : { lo, hi };
  };
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const drop = new THREE.Matrix4();
  return {
    before(i, n) {
      const t = i / Math.max(1, n - 1);
      items.forEach((it, k) => {
        const start = startOf(k);
        const u = Math.max(0, Math.min(1, (t - start) / D));
        if (u <= 0) {
          it.g.visible = false;
          return;
        }
        it.g.visible = true;
        const e = 1 - (1 - u) ** 3;
        drop.makeTranslation(0, 0, 9 * (1 - e));
        it.g.matrix.copy(drop).multiply(it.matrix);
        it.g.updateMatrixWorld(true);
        const solidA = smooth(Math.min(1, u * 1.6));
        for (const s of it.solid) {
          s.m.transparent = true;
          s.m.opacity = s.opacity * solidA;
          s.m.depthWrite = s.depthWrite && solidA > 0.95;
          s.m.needsUpdate = true;
        }
        const uv = Math.max(0, Math.min(1, (t - (start + D * 0.7)) / (D * 1.4)));
        for (const v of it.voids) {
          v.mesh.visible = v.visible && uv > 0;
          v.m.transparent = true;
          v.m.opacity = v.opacity * smooth(uv);
          v.m.depthWrite = v.depthWrite && uv > 0.95;
          v.m.needsUpdate = true;
        }
      });
    },
    extent(t) {
      // the frame follows the standing blocks: averaged over a short window around t, so it eases instead of jumping when a block arrives
      const lo: Vec3 = [0, 0, 0];
      const hi: Vec3 = [0, 0, 0];
      let m = 0;
      for (let q = 0; q < 9; q++) {
        const b = boxAt(Math.min(1, Math.max(0, t - 0.02 + q * 0.01 + 0.02)));
        if (!b) continue;
        for (let a = 0; a < 3; a++) {
          lo[a] += b.lo[a];
          hi[a] += b.hi[a];
        }
        m++;
      }
      if (!m) return null;
      const c: Vec3 = [(lo[0] + hi[0]) / (2 * m), (lo[1] + hi[1]) / (2 * m), (lo[2] + hi[2]) / (2 * m)];
      const r = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / (2 * m);
      return { center: c, radius: Math.max(r, 8) };
    },
    after() {
      for (const it of items) {
        it.g.matrix.copy(it.matrix);
        it.g.visible = it.visible;
        it.g.updateMatrixWorld(true);
        for (const s of it.solid) {
          s.m.opacity = s.opacity;
          s.m.transparent = s.transparent;
          s.m.depthWrite = s.depthWrite;
          s.m.needsUpdate = true;
        }
        for (const v of it.voids) {
          v.mesh.visible = v.visible;
          v.m.opacity = v.opacity;
          v.m.transparent = v.transparent;
          v.m.depthWrite = v.depthWrite;
          v.m.needsUpdate = true;
        }
      }
    },
  };
}
