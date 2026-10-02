// High-resolution stills and turntable frames from any live three.js
// viewport (Viewer, Analysis, Arrange, the cube builder). The live <Canvas>
// is never resized or disturbed: the same scene graph is drawn by a second,
// offscreen WebGLRenderer at the requested size, from a copy of the live
// camera. The scene's environment map belongs to the live renderer's GL
// context, so it is set aside for the instant of each (synchronous) draw.

import * as THREE from "three";
import { ALL_VIEWS, AXO_VIEWS } from "@/lib/faceViews";
import type { BoardAnimation } from "@/lib/boards/exportBoard";

/** What an offscreen render needs from a live viewport. */
export interface ViewportSnapshot {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Where the live camera is looking (the orbit target). */
  target: THREE.Vector3;
  /** The model's centre: the pivot of the vertical axis a turntable spins about. */
  center: THREE.Vector3;
  /** Framing radius of the content, so preset corners sit at the same distance. */
  radius: number;
  /** Width / height of the live canvas. */
  aspect: number;
}

export interface ViewportHandle {
  snapshot(): ViewportSnapshot | null;
}

/** "current" = the live camera; otherwise a view preset key (an axo corner, etc.). */
export type StartView = "current" | string;

export interface CaptureOptions {
  width: number;
  height: number;
  startView: StartView;
  /** Degrees turned about the vertical axis from the start view. */
  orbitDeg?: number;
  /** Solid background colour (ignored when `transparent`). */
  background: string;
  transparent?: boolean;
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const MAX_SIDE = 16384;

export function clampSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height, 1));
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

function presetFor(key: string) {
  return AXO_VIEWS.find((v) => v.key === key) ?? ALL_VIEWS.find((v) => v.key === key) ?? AXO_VIEWS[0];
}

/** A copy of the live camera, placed at the start view and turned. */
function placeCamera(snap: ViewportSnapshot, opts: CaptureOptions, orbitDeg: number): THREE.PerspectiveCamera {
  const cam = snap.camera.clone();
  cam.aspect = opts.width / opts.height;
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3();
  const target = new THREE.Vector3();
  if (opts.startView === "current") {
    pos.copy(snap.camera.position);
    up.copy(snap.camera.up);
    target.copy(snap.target);
  } else {
    const preset = presetFor(opts.startView);
    const vHalf = (cam.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
    const distance = Math.max((snap.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.93, 1);
    pos.copy(snap.center).addScaledVector(new THREE.Vector3(...preset.dir).normalize(), distance);
    up.set(...preset.up);
    target.copy(snap.center);
  }
  // Turn the whole camera rig about the vertical axis through the model --
  // the same as turning the model on a turntable, from any starting angle.
  const a = -THREE.MathUtils.degToRad(orbitDeg);
  pos.sub(snap.center).applyAxisAngle(UP_AXIS, a).add(snap.center);
  target.sub(snap.center).applyAxisAngle(UP_AXIS, a).add(snap.center);
  up.applyAxisAngle(UP_AXIS, a);
  cam.position.copy(pos);
  cam.up.copy(up);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return cam;
}

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

function drawFrame(renderer: THREE.WebGLRenderer, snap: ViewportSnapshot, opts: CaptureOptions, orbitDeg: number) {
  const camera = placeCamera(snap, opts, orbitDeg);
  const { scene } = snap;
  const prevEnv = scene.environment;
  const prevBg = scene.background;
  scene.environment = null;
  scene.background = opts.transparent ? null : new THREE.Color(opts.background);
  try {
    renderer.setClearColor(0x000000, opts.transparent ? 0 : 1);
    renderer.render(scene, camera);
  } finally {
    scene.environment = prevEnv;
    scene.background = prevBg;
  }
}

function need(handle: ViewportHandle): ViewportSnapshot {
  const snap = handle.snapshot();
  if (!snap) throw new Error("The viewport isn't ready yet.");
  return snap;
}

function release(renderer: THREE.WebGLRenderer) {
  renderer.dispose();
  renderer.forceContextLoss();
}

/** One still, as a PNG blob. */
export async function captureViewportPng(handle: ViewportHandle, opts: CaptureOptions): Promise<Blob> {
  const snap = need(handle);
  const size = clampSize(opts.width, opts.height);
  const renderer = makeRenderer(size.width, size.height, !!opts.transparent);
  try {
    drawFrame(renderer, snap, { ...opts, ...size }, opts.orbitDeg ?? 0);
    return await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the PNG."))), "image/png"));
  } finally {
    release(renderer);
  }
}

/** Draws one frame into an existing 2D canvas (the dialog's first-frame preview). */
export function previewViewport(handle: ViewportHandle, opts: CaptureOptions, into: HTMLCanvasElement) {
  const snap = handle.snapshot();
  if (!snap) return;
  const size = clampSize(opts.width, opts.height);
  const renderer = makeRenderer(size.width, size.height, !!opts.transparent);
  try {
    drawFrame(renderer, snap, { ...opts, ...size }, opts.orbitDeg ?? 0);
    into.width = size.width;
    into.height = size.height;
    const ctx = into.getContext("2d");
    ctx?.clearRect(0, 0, size.width, size.height);
    ctx?.drawImage(renderer.domElement, 0, 0);
  } finally {
    release(renderer);
  }
}

/** A BoardAnimation-shaped frame source (see lib/boards/exportBoard.ts), so
 * the GIF and MP4 encoders can take a single viewport exactly as they take a
 * whole board. Even pixel dimensions, as video codecs need. */
export function createViewportAnimation(handle: ViewportHandle, opts: Omit<CaptureOptions, "orbitDeg">, frameCount: number): BoardAnimation {
  const snap = need(handle);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const size = clampSize(even(opts.width), even(opts.height));
  const width = even(size.width);
  const height = even(size.height);
  const renderer = makeRenderer(width, height, false);
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    release(renderer);
    throw new Error("Canvas 2D context unavailable");
  }
  return {
    width,
    height,
    frameCount,
    canvas: frame,
    renderFrame(i: number) {
      drawFrame(renderer, snap, { ...opts, width, height, transparent: false }, (360 * i) / frameCount);
      ctx.drawImage(renderer.domElement, 0, 0);
    },
    dispose: () => release(renderer),
  };
}

// ---- PNG print resolution ---------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Stamps a pixels-per-inch value into a PNG (a pHYs chunk after IHDR), so
 * layout and print software open it at the intended physical size. */
export async function setPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21); // length(4) + "pHYs"(4) + data(9) + crc(4)
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 25; // signature + IHDR chunk
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(src.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return new Blob([out], { type: "image/png" });
}
