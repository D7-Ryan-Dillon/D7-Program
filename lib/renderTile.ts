// Headless (non-React) three.js rendering of a tile's GLB from a fixed axo
// preset. Originally built for the Boards tab -- both its live on-screen
// preview (small) and its print-resolution export (large) go through this
// same function, just at different pixel sizes, so what you see is what you
// get -- now also the source of the small identifying thumbnails shown next
// to a tile's name in every tile bank/list across the app.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AXO_VIEWS, type AxoViewKey } from "@/lib/faceViews";

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<THREE.Group>>();

function loadScene(glbUrl: string): Promise<THREE.Group> {
  let cached = sceneCache.get(glbUrl);
  if (!cached) {
    cached = loader.loadAsync(glbUrl).then((gltf) => gltf.scene);
    sceneCache.set(glbUrl, cached);
  }
  return cached;
}

export interface TileRenderOptions {
  glbUrl: string;
  view: AxoViewKey;
  /** Target pixel size -- rendered at this exact aspect ratio (not forced
   * square), and the camera distance is fit to whichever axis is tighter,
   * so the whole tile shows with no cropping regardless of the cell's own
   * proportions. */
  width: number;
  height: number;
  backgroundColor: string | null;
  foamColor: string;
  voidColor: string;
  foamOpacity: number;
  voidOpacity: number;
  foamVisible: boolean;
  voidVisible: boolean;
}

function applyMaterial(mesh: THREE.Object3D | undefined, color: string, opacity: number, visible: boolean) {
  if (!(mesh instanceof THREE.Mesh)) return;
  mesh.visible = visible;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
  });
}

// Browsers cap how many live WebGL contexts can exist at once (commonly
// 8-16); a bank with a dozen-plus tiles would otherwise fire off that many
// renderTileToDataUrl calls at the same instant (one per thumbnail mounting
// together) and start silently losing contexts. Serializing every call
// through this queue -- thumbnails and the Boards tab's own export/preview
// calls alike -- keeps at most one renderer alive at a time; Boards already
// awaits these sequentially in its own loop, so this changes nothing for it.
let renderQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Renders one tile to a dataURL at `width`x`height` pixels. A fresh
 * renderer per call (rather than a pooled one) keeps this safe to run for
 * several tiles back to back, including at very large export sizes,
 * without one render's leftover state leaking into the next. */
export function renderTileToDataUrl(opts: TileRenderOptions): Promise<string> {
  return serialized(() => renderTileToDataUrlNow(opts));
}

async function renderTileToDataUrlNow(opts: TileRenderOptions): Promise<string> {
  const original = await loadScene(opts.glbUrl);
  const scene = original.clone(true);

  applyMaterial(scene.getObjectByName("foam") ?? undefined, opts.foamColor, opts.foamOpacity, opts.foamVisible);
  applyMaterial(scene.getObjectByName("void") ?? undefined, opts.voidColor, opts.voidOpacity, opts.voidVisible);

  const box = new THREE.Box3().setFromObject(scene);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  const preset = AXO_VIEWS.find((v) => v.key === opts.view) ?? AXO_VIEWS[0];
  const dir = new THREE.Vector3(...preset.dir).normalize();
  const aspect = opts.width / opts.height;
  const vFov = 42;
  // The sphere must fit inside whichever of the two field-of-view angles
  // (vertical, fixed; horizontal, derived from aspect) is tighter -- a
  // portrait cell (aspect < 1) narrows the horizontal fov below the
  // vertical one, so fitting only to vFov would crop the sides.
  const vHalf = (vFov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const constrainingHalf = Math.min(vHalf, hHalf);
  const distance = (radius / Math.sin(constrainingHalf)) * 1.08;
  const camera = new THREE.PerspectiveCamera(vFov, aspect, 0.05, 500);
  camera.position.copy(sphere.center).addScaledVector(dir, distance);
  camera.up.set(...preset.up);
  camera.lookAt(sphere.center);

  const threeScene = new THREE.Scene();
  if (opts.backgroundColor) threeScene.background = new THREE.Color(opts.backgroundColor);
  threeScene.add(scene);
  threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(6, 10, 4);
  threeScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-6, -4, -6);
  threeScene.add(fill);

  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !opts.backgroundColor, preserveDrawingBuffer: true });
  renderer.setSize(opts.width, opts.height, false);
  renderer.setPixelRatio(1);
  renderer.render(threeScene, camera);
  const dataUrl = canvas.toDataURL("image/png");
  renderer.dispose();
  return dataUrl;
}

const thumbnailCache = new Map<string, Promise<string>>();

/** A small identifying preview for a tile bank/list row -- same fixed angle
 * and colors everywhere (matching the Viewer tab's own default look) so
 * thumbnails read consistently across Viewer, Analysis, Arrange and Boards,
 * rather than each tab inventing its own. Cached per glbUrl+size: several
 * banks can show the same tile at the same time (e.g. Arrange and Boards
 * open together isn't possible today, but Viewer/Analysis's own switcher
 * and a future split view might), and a tile's GLB never changes once
 * loaded. */
export function renderTileThumbnail(glbUrl: string, size: number): Promise<string> {
  const key = `${glbUrl}@${size}`;
  let cached = thumbnailCache.get(key);
  if (!cached) {
    cached = renderTileToDataUrl({
      glbUrl,
      view: "iso-ne",
      width: size,
      height: size,
      backgroundColor: null,
      foamColor: "#e8a6c8",
      voidColor: "#1c1c1f",
      foamOpacity: 1,
      voidOpacity: 1,
      foamVisible: true,
      voidVisible: true,
    });
    thumbnailCache.set(key, cached);
    cached.catch(() => thumbnailCache.delete(key));
  }
  return cached;
}
