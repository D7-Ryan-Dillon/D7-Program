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
  hooks: { before?: (i: number) => void; after?: () => void; } = {},
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
