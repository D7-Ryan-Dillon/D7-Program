// Headless (non-React) three.js rendering of a tile's GLB from a fixed axo
// preset, for the Boards tab -- both its live on-screen preview (small) and
// its print-resolution export (large) go through this same function, just
// at different pixel sizes, so what you see is what you get.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AXO_VIEWS } from "@/lib/faceViews";
import type { AxoViewKey } from "./types";

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
  size: number;
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

/** Renders one tile to a dataURL at `size`x`size` pixels. A fresh renderer
 * per call (rather than a pooled one) keeps this safe to run for several
 * tiles back to back, including at very large export sizes, without one
 * render's leftover state leaking into the next. */
export async function renderTileToDataUrl(opts: TileRenderOptions): Promise<string> {
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
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  camera.position.copy(sphere.center).addScaledVector(dir, radius * 2.6);
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
  canvas.width = opts.size;
  canvas.height = opts.size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !opts.backgroundColor, preserveDrawingBuffer: true });
  renderer.setSize(opts.size, opts.size, false);
  renderer.setPixelRatio(1);
  renderer.render(threeScene, camera);
  const dataUrl = canvas.toDataURL("image/png");
  renderer.dispose();
  return dataUrl;
}
